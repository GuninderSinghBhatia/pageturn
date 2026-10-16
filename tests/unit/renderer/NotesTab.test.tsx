// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { NotesGroup } from '@shared/ipc'
import type { Book, Note } from '@shared/types'
import { NotesTab } from '@renderer/home/NotesTab'
import { useNav } from '@renderer/app/nav'
import { useLibraryStore } from '@renderer/stores/libraryStore'

const book: Book = {
  id: '1'.repeat(64),
  path: 'C:\\books\\habits.pdf',
  title: 'Atomic Habits',
  author: 'James Clear',
  numPages: 200,
  lastPage: 50,
  addedAt: 1,
  lastOpenedAt: 5,
  liked: false,
  missing: false,
  thumbnailUrl: null
}
const note = (over: Partial<Note>): Note => ({
  id: 'n1',
  bookId: book.id,
  page: 42,
  anchor: { highlightId: 'h1' },
  body: 'Chapter 3\nSystems matter more than goals.',
  tags: ['idea'],
  createdAt: Date.now() - 2 * 86_400_000,
  updatedAt: Date.now() - 2 * 86_400_000,
  ...over
})

let groups: NotesGroup[]
const api = {
  listAllNotes: vi.fn(async () => groups),
  upsertNote: vi.fn(async () => {}),
  setNoteTags: vi.fn(async () => {}),
  deleteNote: vi.fn(async () => {})
}

beforeEach(() => {
  groups = [
    {
      book,
      notes: [
        { note: note({}), quote: 'You do not rise to the level of your goals' },
        {
          note: note({
            id: 'n2',
            page: 7,
            body: 'Habit stacking',
            tags: ['review', 'important'],
            updatedAt: Date.now() - 60_000
          }),
          quote: null
        }
      ]
    }
  ]
  Object.values(api).forEach((f) => f.mockClear())
  window.api = { annotations: api } as unknown as typeof window.api
  useLibraryStore.setState({ books: [book] })
  useNav.setState({ view: 'library', settingsOpen: false })
})
afterEach(cleanup)

const card = (title: string): HTMLElement => screen.getByRole('article', { name: `Note: ${title}` })

describe('NotesTab', () => {
  it('cards show title, page badge, book, quote, body, tags and when; newest first', async () => {
    render(<NotesTab />)
    await screen.findByRole('article', { name: 'Note: Chapter 3' })
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Note: Habit stacking',
      'Note: Chapter 3'
    ])
    const c = within(card('Chapter 3'))
    expect(c.getByText('p. 42')).toBeTruthy()
    expect(c.getByText('Atomic Habits · James Clear')).toBeTruthy()
    expect(c.getByText('“You do not rise to the level of your goals”')).toBeTruthy()
    expect(c.getByText('Systems matter more than goals.')).toBeTruthy()
    expect(c.getByText('idea')).toBeTruthy()
    expect(c.getByText('2 days ago')).toBeTruthy()
    expect(
      c.getByRole('progressbar', { name: 'Reading progress' }).getAttribute('aria-valuenow')
    ).toBe('25')
  })

  it('the tag filter and the search box narrow the grid', async () => {
    const { rerender } = render(<NotesTab />)
    await screen.findByRole('article', { name: 'Note: Chapter 3' })
    fireEvent.click(screen.getByRole('button', { name: /important/ }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    rerender(<NotesTab query="rise to the level" />)
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Note: Chapter 3'
    ])
  })

  it('Edit changes the text and tags; Save writes both', async () => {
    render(<NotesTab />)
    await screen.findByRole('article', { name: 'Note: Chapter 3' })
    fireEvent.click(within(card('Chapter 3')).getByRole('button', { name: 'Edit' }))
    expect(card('Chapter 3').className).toMatch(/selected/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), {
      target: { value: 'Chapter 3\nSystems beat goals.' }
    })
    const tags = within(screen.getByRole('group', { name: 'Tags' }))
    fireEvent.click(tags.getByRole('button', { name: 'idea' })) // off
    fireEvent.click(tags.getByRole('button', { name: 'review' })) // on
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.setNoteTags).toHaveBeenCalledWith('n1', ['review']))
    expect(api.upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1', body: 'Chapter 3\nSystems beat goals.' })
    )
    expect(api.listAllNotes).toHaveBeenCalledTimes(2) // reloaded
  })

  it('Delete asks first; a click on the card opens the book at the note page', async () => {
    render(<NotesTab />)
    await screen.findByRole('article', { name: 'Note: Chapter 3' })
    const c = within(card('Habit stacking'))
    fireEvent.click(c.getByRole('button', { name: 'Delete' }))
    expect(api.deleteNote).not.toHaveBeenCalled()
    fireEvent.click(c.getByRole('button', { name: 'Delete' })) // confirm
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith('n2'))

    fireEvent.click(within(card('Chapter 3')).getByText('Systems matter more than goals.'))
    expect(useNav.getState().view).toEqual({ reader: book.id, page: 42 })
  })

  it('empty: a primary New note button opens the last book', async () => {
    groups = []
    render(<NotesTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'New note' }))
    expect(useNav.getState().view).toEqual({ reader: book.id, page: 50 })
  })
})
