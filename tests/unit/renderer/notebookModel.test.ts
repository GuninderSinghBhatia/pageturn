import { describe, it, expect } from 'vitest'
import type { Bookmark, Highlight, InkStroke, Note } from '@shared/types'
import {
  filterItems,
  groupItems,
  toItems,
  type NotebookFilter,
  type NotebookItem
} from '@renderer/notebook/notebookModel'

const B = 'b'.repeat(64)
const hl = (
  id: string,
  page: number,
  color: Highlight['color'],
  text: string,
  noteId: string | null = null
): Highlight => ({
  id,
  bookId: B,
  page,
  rects: [],
  text,
  color,
  style: 'highlight',
  noteId,
  createdAt: page,
  updatedAt: page
})
const note = (id: string, page: number, body: string, highlightId?: string): Note => ({
  id,
  bookId: B,
  page,
  anchor: highlightId ? { highlightId } : { point: { x: 0.1, y: 0.1 } },
  body,
  createdAt: 1,
  updatedAt: 1
})

const store = {
  highlights: {
    h1: hl('h1', 3, 'yellow', 'Entropy always increases', 'n1'),
    h2: hl('h2', 9, 'blue', 'The arrow of time'),
    h3: hl('h3', 12, 'green', 'Second law')
  },
  notes: {
    n1: note('n1', 3, 'check the proof'),
    n2: note('n2', 5, 'free thought')
  },
  bookmarks: {
    7: { id: 'bm', bookId: B, page: 7, label: 'Key chapter', createdAt: 2 } as Bookmark
  },
  ink: {
    s1: { id: 's1', page: 4 } as InkStroke,
    s2: { id: 's2', page: 4 } as InkStroke
  }
}

const filter = (over: Partial<NotebookFilter> = {}): NotebookFilter => ({
  query: '',
  kinds: new Set(),
  colors: new Set(),
  groupBy: 'page',
  ...over
})

describe('notebookModel', () => {
  const items: NotebookItem[] = toItems(store)

  it('lists highlights (with their note), free notes, bookmarks and one ink item per page', () => {
    expect(items.map((i) => `${i.kind}:${i.page}`).sort()).toEqual(
      ['bookmark:7', 'highlight:12', 'highlight:3', 'highlight:9', 'ink:4', 'note:5'].sort()
    )
    expect(items.find((i) => i.id === 'h1')?.noteText).toBe('check the proof')
  })

  it('the search matches note text too, ignoring case', () => {
    expect(filterItems(items, filter({ query: 'PROOF' })).map((i) => i.id)).toEqual(['h1'])
  })

  it('a colour filter keeps only highlights of those colours', () => {
    expect(filterItems(items, filter({ colors: new Set(['blue']) })).map((i) => i.id)).toEqual([
      'h2'
    ])
  })

  it('a kind filter keeps only those kinds', () => {
    expect(
      filterItems(items, filter({ kinds: new Set(['bookmark', 'note']) }))
        .map((i) => i.kind)
        .sort()
    ).toEqual(['bookmark', 'note'])
  })

  it('grouped by colour in a fixed order', () => {
    const groups = groupItems(
      filterItems(items, filter({ kinds: new Set(['highlight']) })),
      'color'
    )
    expect(groups.map((g) => g.key)).toEqual(['Yellow', 'Green', 'Blue'])
  })

  it('grouped by page in ascending order', () => {
    const groups = groupItems(items, 'page')
    expect(groups.map((g) => g.key)).toEqual([
      'Page 3',
      'Page 4',
      'Page 5',
      'Page 7',
      'Page 9',
      'Page 12'
    ])
  })
})
