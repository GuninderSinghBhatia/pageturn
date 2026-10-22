import { describe, it, expect } from 'vitest'
import type { Bookmark, Highlight, Note } from '@shared/types'
import {
  escapeLineStart,
  quoteBlock,
  renderMarkdown,
  type ExportInput
} from '../../../src/main/export/markdown'

const B = 'b'.repeat(64)
const hl = (over: Partial<Highlight>): Highlight => ({
  id: 'h1',
  bookId: B,
  page: 3,
  rects: [],
  text: 'quoted text',
  color: 'yellow',
  style: 'highlight',
  noteId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over
})
const note = (over: Partial<Note>): Note => ({
  id: 'n1',
  bookId: B,
  page: 3,
  anchor: {},
  body: 'a note',
  createdAt: 1,
  updatedAt: 1,
  ...over
})
const bm = (over: Partial<Bookmark>): Bookmark => ({
  id: 'b1',
  bookId: B,
  page: 7,
  label: null,
  createdAt: 1,
  ...over
})
const input = (over: Partial<ExportInput>): ExportInput => ({
  title: 'My Book',
  highlights: [],
  notes: [],
  inkPages: [],
  bookmarks: [],
  ...over
})

describe('renderMarkdown', () => {
  it('a book with nothing in it still says so', () => {
    expect(renderMarkdown(input({}))).toBe('# My Book\n\n_No highlights or notes yet._\n')
  })

  it('renders pages in order with highlights, notes, bookmarks and ink', () => {
    const md = renderMarkdown(
      input({
        highlights: [
          hl({ id: 'h2', text: 'second on page', color: 'blue', createdAt: 5 }),
          hl({ id: 'h1', text: 'first on page', noteId: 'n1', createdAt: 2 })
        ],
        notes: [
          note({ id: 'n1', anchor: { highlightId: 'h1' }, body: 'why this matters' }),
          note({ id: 'n2', page: 7, anchor: { point: { x: 0.5, y: 0.5 } }, body: 'free note' })
        ],
        bookmarks: [bm({ label: 'Proof' })],
        inkPages: [7]
      })
    )
    expect(md).toBe(
      '# My Book\n\n' +
        '## Page 3\n\n' +
        '> first on page — *yellow*\n\nwhy this matters\n\n' +
        '> second on page — *blue*\n\n' +
        '## Page 7\n\n' +
        '🔖 Bookmark: Proof\n\n' +
        '📝 free note\n\n' +
        'Page 7 — handwritten notes\n'
    )
  })

  it('multi-line quotes stay quoted on every line', () => {
    const md = renderMarkdown(input({ highlights: [hl({ text: 'line one\nline two' })] }))
    expect(md).toContain('> line one\n> line two — *yellow*')
  })

  it('note text that looks like Markdown syntax is escaped', () => {
    const md = renderMarkdown(
      input({
        highlights: [hl({ noteId: 'n1' })],
        notes: [note({ anchor: { highlightId: 'h1' }, body: '# not heading\n> not quote' })]
      })
    )
    expect(md).toContain('\\# not heading\n\\> not quote')
  })

  it('pages sort numerically (10 after 9)', () => {
    const md = renderMarkdown(
      input({ highlights: [hl({ id: 'a', page: 10 }), hl({ id: 'b', page: 9 })] })
    )
    expect(md.indexOf('## Page 9')).toBeLessThan(md.indexOf('## Page 10'))
  })
})

describe('helpers', () => {
  it('quoteBlock prefixes every line', () => {
    expect(quoteBlock('a\nb')).toBe('> a\n> b')
  })
  it('escapeLineStart escapes block syntax at line starts only', () => {
    expect(escapeLineStart('# h\n- item\n+ plus\n1. one\nmid # ok')).toBe(
      '\\# h\n\\- item\n\\+ plus\n1\\. one\nmid # ok'
    )
  })
})
