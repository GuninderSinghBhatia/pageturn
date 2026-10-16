// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Book } from '@shared/types'

vi.mock('@renderer/library/thumbnails', () => ({ generateThumbnail: vi.fn(async () => {}) }))

import { HomeView } from '@renderer/home/HomeView'
import { useNav } from '@renderer/app/nav'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

const book = (over: Partial<Book>): Book => ({
  id: 'a'.repeat(64),
  path: 'C:\\books\\file.pdf',
  title: null,
  author: null,
  numPages: 100,
  lastPage: 1,
  addedAt: 1,
  lastOpenedAt: null,
  liked: false,
  missing: false,
  thumbnailUrl: 'data:image/png;base64,AA==',
  ...over
})

const zeta = book({ id: '1'.repeat(64), title: 'Zeta Functions', author: 'Riemann', lastPage: 50 })
const books: Book[] = [
  zeta,
  book({ id: '2'.repeat(64), path: 'C:\\books\\alpha-notes.pdf', title: null }),
  book({ id: '3'.repeat(64), title: 'Middlemarch', author: 'George Eliot', missing: true })
]
const setLiked = vi.fn(async () => {})
const listAllNotes = vi.fn(async () => [
  {
    book: zeta,
    notes: [
      {
        note: {
          id: 'n1',
          bookId: zeta.id,
          page: 42,
          anchor: { highlightId: 'h1' },
          body: 'Check the pole at s = 1',
          createdAt: Date.UTC(2026, 9, 1),
          updatedAt: Date.UTC(2026, 9, 1)
        },
        quote: 'the zeta function has a pole'
      }
    ]
  }
])

beforeEach(() => {
  useLibraryStore.setState({ books: [] })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  useNav.setState({ view: 'library', settingsOpen: false, homeTab: 'books' })
  setLiked.mockClear()
  window.api = {
    library: {
      list: vi.fn(async () => books),
      onChanged: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      setLiked
    },
    annotations: { listAllNotes },
    settings: { get: vi.fn(async () => DEFAULT_SETTINGS), set: vi.fn(async () => DEFAULT_SETTINGS) }
  } as unknown as typeof window.api
})
afterEach(cleanup)

const titles = (): string[] =>
  screen.getAllByTestId('book-card').map((c) => within(c).getByTestId('book-title').textContent!)

describe('HomeView', () => {
  it('has a top bar with the four sections, Books selected', async () => {
    render(<HomeView />)
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Books', 'Notes', 'Search Online', 'Settings'])
    expect(screen.getByRole('tab', { name: 'Books' }).getAttribute('aria-selected')).toBe('true')
    await screen.findAllByTestId('book-card')
  })

  it('shows the books in a slider with the focused book in the middle and its details below', async () => {
    render(<HomeView />)
    await screen.findAllByTestId('book-card')
    expect(titles()).toEqual(['Zeta Functions', 'alpha-notes', 'Middlemarch'])
    expect(screen.getAllByTestId('book-card')[0].getAttribute('aria-current')).toBe('true')
    const details = screen.getByRole('region', { name: 'Selected book' })
    expect(within(details).getByRole('heading', { name: 'Zeta Functions' })).toBeTruthy()
    expect(within(details).getByText('Riemann · 100 pages · Page 50 (50%)')).toBeTruthy()
    expect(within(details).getByRole('button', { name: /Continue reading/ })).toBeTruthy()
  })

  it('arrows, keys and clicking a side cover move the focus; the centre cover opens', async () => {
    render(<HomeView />)
    await screen.findAllByTestId('book-card')
    const heading = (): string =>
      within(screen.getByRole('region', { name: 'Selected book' })).getByRole('heading')
        .textContent!
    fireEvent.click(screen.getByRole('button', { name: 'Next book' }))
    expect(heading()).toBe('alpha-notes')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(heading()).toBe('Middlemarch')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous book' }))
    expect(heading()).toBe('Zeta Functions')
    fireEvent.click(screen.getByRole('button', { name: 'Open alpha-notes' })) // a side cover
    expect(heading()).toBe('alpha-notes')
    expect(useNav.getState().view).toBe('library') // focused, not opened
    fireEvent.click(screen.getByRole('button', { name: 'Open alpha-notes' })) // now centred
    expect(useNav.getState().view).toEqual({ reader: '2'.repeat(64), page: undefined })
  })

  it('like toggles from the details row', async () => {
    render(<HomeView />)
    await screen.findAllByTestId('book-card')
    const heart = screen.getByRole('button', { name: 'Like Zeta Functions' })
    expect(heart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(heart)
    expect(setLiked).toHaveBeenCalledWith(zeta.id, true)
    await waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('true'))
  })

  it('Details shows the book facts and offers Remove; missing files are marked', async () => {
    render(<HomeView />)
    await screen.findAllByTestId('book-card')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    const panel = screen.getByRole('dialog', { name: 'Book details' })
    expect(within(panel).getByText('C:\\books\\file.pdf')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Remove from library' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'End' })
    const details = screen.getByRole('region', { name: 'Selected book' })
    expect(within(details).getByText('Missing')).toBeTruthy()
  })

  it('the search icon narrows the slider', async () => {
    render(<HomeView />)
    await screen.findAllByTestId('book-card')
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'eliot' } })
    expect(titles()).toEqual(['Middlemarch'])
  })

  it('Notes lists notes by book; clicking one opens the book at that page', async () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    const note = await screen.findByText('Check the pole at s = 1')
    expect(screen.getByText(/the zeta function has a pole/)).toBeTruthy()
    expect(screen.getByText(/Page 42/)).toBeTruthy()
    fireEvent.click(note)
    expect(useNav.getState().view).toEqual({ reader: zeta.id, page: 42 })
  })

  it('Search Online is a placeholder for now', () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Search Online' }))
    expect(screen.getByText(/coming soon/i)).toBeTruthy()
  })

  it('Settings opens inside the page', () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
  })
})
