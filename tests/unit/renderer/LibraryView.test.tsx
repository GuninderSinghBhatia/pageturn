// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { Book } from '@shared/types'

vi.mock('@renderer/library/thumbnails', () => ({ generateThumbnail: vi.fn(async () => {}) }))

import { LibraryView } from '@renderer/library/LibraryView'
import { useLibraryStore } from '@renderer/stores/libraryStore'

const book = (over: Partial<Book>): Book => ({
  id: 'a'.repeat(64),
  path: 'C:\\books\\file.pdf',
  title: null,
  author: null,
  numPages: 100,
  lastPage: 1,
  addedAt: 1,
  lastOpenedAt: null,
  missing: false,
  thumbnailUrl: 'data:image/png;base64,AA==',
  ...over
})

const books: Book[] = [
  book({ id: '1'.repeat(64), title: 'Zeta Functions', lastPage: 50 }),
  book({ id: '2'.repeat(64), path: 'C:\\books\\alpha-notes.pdf', title: null }),
  book({ id: '3'.repeat(64), title: 'Middlemarch', missing: true })
]

beforeEach(() => {
  useLibraryStore.setState({ books: [] })
  window.api = {
    library: {
      list: vi.fn(async () => books),
      onChanged: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => '')
    }
  } as unknown as typeof window.api
})
afterEach(cleanup)

const titles = (): string[] =>
  screen.getAllByTestId('book-card').map((c) => within(c).getByTestId('book-title').textContent!)

describe('LibraryView', () => {
  it('shows a card per book, using the filename when there is no title', async () => {
    render(<LibraryView />)
    await screen.findByText('Zeta Functions')
    expect(titles()).toEqual(['Zeta Functions', 'alpha-notes', 'Middlemarch'])
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('filters by title search', async () => {
    render(<LibraryView />)
    await screen.findByText('Zeta Functions')
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zeta' } })
    expect(titles()).toEqual(['Zeta Functions'])
  })

  it('sorts by title', async () => {
    render(<LibraryView />)
    await screen.findByText('Zeta Functions')
    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'title' } })
    expect(titles()).toEqual(['alpha-notes', 'Middlemarch', 'Zeta Functions'])
  })

  it('marks missing books', async () => {
    render(<LibraryView />)
    const card = (await screen.findByText('Middlemarch')).closest('[data-testid="book-card"]')!
    expect(within(card as HTMLElement).getByText('Missing')).toBeTruthy()
    expect(within(card as HTMLElement).getByRole('button', { name: /relocate/i })).toBeTruthy()
  })
})
