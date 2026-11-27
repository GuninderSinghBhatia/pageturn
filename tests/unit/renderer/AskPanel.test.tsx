// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import type { RagIndexStatus } from '@shared/ipc'
import { AskPanel } from '@renderer/ask/AskPanel'
import { useAskStore } from '@renderer/ask/askStore'
import { useReaderStore } from '@renderer/stores/readerStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

let stored: Settings
const answer = { ok: true as const, answer: 'An answer.', pages: [3] }
const api = {
  settings: {
    get: vi.fn(async () => stored),
    set: vi.fn(async (p: Partial<Settings>) => (stored = { ...stored, ...p }))
  },
  rag: {
    ask: vi.fn(async () => answer),
    who: vi.fn(async () => ({ ...answer, related: [] })),
    indexStatus: vi.fn(async (): Promise<RagIndexStatus> => done),
    indexBook: vi.fn(async (): Promise<RagIndexStatus> => queued)
  }
}

const done: RagIndexStatus = { ok: true, state: 'done', done: 0, total: 0 }
const queued: RagIndexStatus = { ok: true, state: 'queued', done: 0, total: 0 }

/** Reading book-1 (100 pages) at page 10, one page at a time. */
function openBook(shield: Record<string, boolean> = {}): void {
  stored = { ...DEFAULT_SETTINGS, spoilerShield: shield }
  useSettingsStore.setState({ settings: stored, loaded: true })
  useReaderStore.setState({
    bookId: 'book-1',
    page: 10,
    layout: 'single',
    doc: { numPages: 100 } as unknown as ReturnType<typeof useReaderStore.getState>['doc']
  })
  useAskStore.setState({ open: true, pendingName: null, readyBook: null })
}

async function ask(q: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: q } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  expect(await screen.findByText('An answer.')).toBeTruthy()
}

beforeEach(() => {
  Object.values(api.settings).forEach((f) => f.mockClear())
  Object.values(api.rag).forEach((f) => f.mockClear())
  api.rag.indexStatus.mockImplementation(async () => done)
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
  window.api = api as unknown as typeof window.api
})
afterEach(cleanup)

describe('AskPanel: Spoiler Shield', () => {
  it('waits for indexing, showing progress, then shows the Shield question', async () => {
    openBook()
    api.rag.indexStatus
      .mockResolvedValueOnce({ ok: true, state: 'indexing', done: 40, total: 100 })
      .mockResolvedValueOnce(done)
    render(<AskPanel />)
    expect(await screen.findByText('Indexing this book for Ask… 40%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
    expect(screen.queryByText(/Turn on Spoiler Shield\?/)).toBeNull()
    expect(await screen.findByText(/Turn on Spoiler Shield\?/, {}, { timeout: 3000 })).toBeTruthy()
  })

  it('queues a book the service has not seen; a failed book can be tried again', async () => {
    openBook()
    api.rag.indexStatus.mockResolvedValueOnce({ ok: true, state: 'missing', done: 0, total: 0 })
    api.rag.indexBook.mockResolvedValueOnce({
      ok: true,
      state: 'failed',
      done: 0,
      total: 0,
      error: 'no text found'
    })
    render(<AskPanel />)
    expect(await screen.findByText(/couldn.t be indexed/)).toBeTruthy()
    expect(api.rag.indexBook).toHaveBeenCalledWith('book-1', false)
    expect(screen.getByText('no text found')).toBeTruthy()
    api.rag.indexBook.mockResolvedValueOnce(done)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.rag.indexBook).toHaveBeenCalledWith('book-1', true))
    expect(await screen.findByText(/Turn on Spoiler Shield\?/)).toBeTruthy()
  })

  it('says when the RAG service is not running', async () => {
    openBook()
    api.rag.indexStatus.mockResolvedValueOnce({ ok: false, error: 'not reachable' })
    render(<AskPanel />)
    expect(await screen.findByText(/RAG service, and it isn.t running/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/Turn on Spoiler Shield\?/)).toBeTruthy()
  })

  it('asks first in a new book; "Yes" saves it for that book and keeps answers to pages read', async () => {
    openBook({ 'other-book': false })
    render(<AskPanel />)
    expect(await screen.findByText(/Turn on Spoiler Shield\?/)).toBeTruthy()
    expect(screen.queryByLabelText('Question')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, no spoilers' }))
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({
        spoilerShield: { 'other-book': false, 'book-1': true }
      })
    )
    const sw = await screen.findByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.textContent).toMatch(/pages 1–10/)
    await ask('Who wins?')
    expect(api.rag.ask).toHaveBeenCalledWith('Who wins?', 10, 'book-1')
  })

  it('"No" uses the whole book; the switch turns it back on', async () => {
    openBook()
    render(<AskPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'No, use the whole book' }))
    const sw = await screen.findByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await ask('How does it end?')
    expect(api.rag.ask).toHaveBeenLastCalledWith('How does it end?', 100, 'book-1')

    fireEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    expect(stored.spoilerShield).toEqual({ 'book-1': true })
    await ask('How does it end?')
    expect(api.rag.ask).toHaveBeenLastCalledWith('How does it end?', 10, 'book-1')
  })

  it('an answered book is not asked again', async () => {
    openBook({ 'book-1': false })
    render(<AskPanel />)
    expect((await screen.findByRole('switch')).textContent).toMatch(/whole book/)
    expect(screen.queryByText(/Turn on Spoiler Shield\?/)).toBeNull()
  })

  it('"Who is this?" in a new book waits for the answer, then looks the name up', async () => {
    openBook()
    render(<AskPanel />)
    await screen.findByText(/Turn on Spoiler Shield\?/)
    useAskStore.getState().askWho('Alice')
    await new Promise((r) => setTimeout(r, 20))
    expect(api.rag.who).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, no spoilers' }))
    await waitFor(() => expect(api.rag.who).toHaveBeenCalledWith('Alice', 10, 'book-1'))
    expect(useAskStore.getState().pendingName).toBeNull()
  })
})
