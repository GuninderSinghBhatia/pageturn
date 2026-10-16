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
    await screen.findByText('Zeta Functions')
  })

  it('cards show title, author, a like button and the page reached with a progress bar', async () => {
    render(<HomeView />)
    const card = (await screen.findByText('Zeta Functions')).closest('[data-testid="book-card"]')!
    const c = within(card as HTMLElement)
    expect(c.getByText('Riemann')).toBeTruthy()
    expect(c.getByText('Page 50 / 100')).toBeTruthy()
    expect(c.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    const heart = c.getByRole('button', { name: 'Like Zeta Functions' })
    expect(heart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(heart)
    expect(setLiked).toHaveBeenCalledWith(zeta.id, true)
    await waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('true'))
  })

  it('uses the filename when a book has no title, and marks missing files', async () => {
    render(<HomeView />)
    await screen.findByText('Zeta Functions')
    expect(titles()).toEqual(['Zeta Functions', 'alpha-notes', 'Middlemarch'])
    const card = screen.getByText('Middlemarch').closest('[data-testid="book-card"]')!
    expect(within(card as HTMLElement).getByText('Missing')).toBeTruthy()
  })

  it('the search icon opens a filter for the grid', async () => {
    render(<HomeView />)
    await screen.findByText('Zeta Functions')
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
