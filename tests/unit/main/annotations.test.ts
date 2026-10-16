import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Highlight, InkStroke, Note } from '@shared/types'
import { openDb } from '../../../src/main/db/connection'
import { BooksRepo } from '../../../src/main/db/repositories/books'
import { AnnotationsRepo } from '../../../src/main/db/repositories/annotations'
import { InkRepo } from '../../../src/main/db/repositories/ink'

const bookId = 'a'.repeat(64)
let db: Database.Database
let books: BooksRepo
let repo: AnnotationsRepo
let ink: InkRepo

const highlight = (over: Partial<Highlight> = {}): Highlight => ({
  id: randomUUID(),
  bookId,
  page: 2,
  rects: [
    { x: 0.1, y: 0.2, w: 0.5, h: 0.02 },
    { x: 0.1, y: 0.23, w: 0.31, h: 0.02 }
  ],
  text: 'Lorem ipsum',
  color: 'yellow',
  style: 'highlight',
  noteId: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...over
})

const note = (over: Partial<Note> = {}): Note => ({
  id: randomUUID(),
  bookId,
  page: 2,
  anchor: { point: { x: 0.5, y: 0.5 } },
  body: 'about photosynthesis',
  createdAt: 1000,
  updatedAt: 1000,
  ...over
})

const stroke = (over: Partial<InkStroke> = {}): InkStroke => ({
  id: randomUUID(),
  bookId,
  page: 3,
  points: [
    [0.1, 0.1, 0.5],
    [0.2, 0.15, 0.7],
    [0.3333333, 0.2, 0.9]
  ],
  color: '#1f1f1f',
  width: 0.005,
  tool: 'pen',
  createdAt: 1000,
  ...over
})

const ftsHits = (term: string): number =>
  (db.prepare('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?').all(term) as unknown[]).length

beforeEach(() => {
  db = openDb(':memory:')
  books = new BooksRepo(db)
  books.upsert({ id: bookId, path: 'C:\\a.pdf' })
  repo = new AnnotationsRepo(db)
  ink = new InkRepo(db)
})
afterEach(() => db.close())

describe('AnnotationsRepo highlights', () => {
  it('round-trips a highlight with its rects', () => {
    const h = highlight()
    repo.upsertHighlight(h)
    expect(repo.listForBook(bookId).highlights).toEqual([h])
  })

  it('upserting the same id updates colour and updatedAt', () => {
    const h = highlight()
    repo.upsertHighlight(h)
    repo.upsertHighlight({ ...h, color: 'green', updatedAt: 2000 })
    const [got] = repo.listForBook(bookId).highlights
    expect(got.color).toBe('green')
    expect(got.updatedAt).toBe(2000)
    expect(got.createdAt).toBe(1000)
  })
})

describe('AnnotationsRepo styles and labels', () => {
  it('round-trips the highlight style', () => {
    const h = highlight({ style: 'wavy' })
    repo.upsertHighlight(h)
    expect(repo.listForBook(bookId).highlights[0].style).toBe('wavy')
  })

  it('renames a bookmark', () => {
    const b = repo.toggleBookmark(bookId, 4)!
    repo.renameBookmark(b.id, 'Proof of lemma')
    expect(repo.listForBook(bookId).bookmarks[0].label).toBe('Proof of lemma')
  })
})

describe('AnnotationsRepo notes', () => {
  it('a note anchored to a highlight sets its noteId; deleting the note clears it', () => {
    const h = highlight()
    repo.upsertHighlight(h)
    const n = note({ anchor: { highlightId: h.id } })
    repo.upsertNote(n)
    expect(repo.listForBook(bookId).highlights[0].noteId).toBe(n.id)
    repo.deleteNote(n.id)
    expect(repo.listForBook(bookId).highlights[0].noteId).toBeNull()
    expect(repo.listForBook(bookId).notes).toEqual([])
  })

  it('deleting a highlight deletes its note', () => {
    const h = highlight()
    repo.upsertHighlight(h)
    repo.upsertNote(note({ anchor: { highlightId: h.id } }))
    repo.deleteHighlight(h.id)
    const all = repo.listForBook(bookId)
    expect(all.highlights).toEqual([])
    expect(all.notes).toEqual([])
  })

  it('keeps notes_fts in sync on insert, update and delete', () => {
    const n = note()
    repo.upsertNote(n)
    expect(ftsHits('photosynthesis')).toBe(1)
    repo.upsertNote({ ...n, body: 'about mitochondria', updatedAt: 2000 })
    expect(ftsHits('photosynthesis')).toBe(0)
    expect(ftsHits('mitochondria')).toBe(1)
    repo.deleteNote(n.id)
    expect(ftsHits('mitochondria')).toBe(0)
  })
})

describe('AnnotationsRepo bookmarks', () => {
  it('toggleBookmark adds then removes', () => {
    const b = repo.toggleBookmark(bookId, 5)
    expect(b).toMatchObject({ bookId, page: 5, label: null })
    expect(repo.listForBook(bookId).bookmarks).toHaveLength(1)
    expect(repo.toggleBookmark(bookId, 5)).toBeNull()
    expect(repo.listForBook(bookId).bookmarks).toEqual([])
  })

  it('uses the supplied id and label', () => {
    const id = randomUUID()
    expect(repo.toggleBookmark(bookId, 7, 'Chapter 2', id)).toMatchObject({
      id,
      label: 'Chapter 2'
    })
  })
})

describe('InkRepo', () => {
  it('stores points as Float32 and returns them within 1e-6', () => {
    const a = stroke()
    const b = stroke({ tool: 'highlighter', color: '#2a62c9' })
    ink.add([a, b])
    const got = ink.listForBook(bookId)
    expect(got).toHaveLength(2)
    const ga = got.find((s) => s.id === a.id)!
    expect({ ...ga, points: [] }).toEqual({ ...a, points: [] })
    ga.points.forEach((pt, i) => pt.forEach((v, j) => expect(v).toBeCloseTo(a.points[i][j], 6)))
    ink.delete([a.id])
    expect(ink.listForBook(bookId).map((s) => s.id)).toEqual([b.id])
  })
})

describe('book removal', () => {
  it('hide keeps annotations and re-import restores the book (Review Focus 4)', () => {
    repo.upsertHighlight(highlight())
    ink.add([stroke()])
    books.hide(bookId)
    expect(books.list()).toEqual([])
    expect(repo.listForBook(bookId).highlights).toHaveLength(1)
    books.upsert({ id: bookId, path: 'C:\\moved.pdf' })
    expect(books.list().map((b) => b.id)).toEqual([bookId])
    expect(repo.listForBook(bookId).highlights).toHaveLength(1)
    expect(ink.listForBook(bookId)).toHaveLength(1)
  })

  it('purge cascades every annotation away', () => {
    repo.upsertHighlight(highlight())
    repo.upsertNote(note())
    repo.toggleBookmark(bookId, 3)
    ink.add([stroke()])
    books.purge(bookId)
    expect(repo.listForBook(bookId)).toEqual({ highlights: [], notes: [], bookmarks: [] })
    expect(ink.listForBook(bookId)).toEqual([])
  })

  it('deleteAllForBook clears annotations but keeps the book', () => {
    repo.upsertHighlight(highlight())
    repo.toggleBookmark(bookId, 3)
    ink.add([stroke()])
    repo.deleteAllForBook(bookId)
    expect(repo.listForBook(bookId)).toEqual({ highlights: [], notes: [], bookmarks: [] })
    expect(ink.listForBook(bookId)).toEqual([])
    expect(books.get(bookId)).not.toBeNull()
  })
})

describe('home page data', () => {
  it('books can be liked, and the flag persists', () => {
    expect(books.list()[0].liked).toBe(false)
    books.setLiked(bookId, true)
    expect(books.list()[0].liked).toBe(true)
    books.setLiked(bookId, false)
    expect(books.get(bookId)!.liked).toBe(false)
  })

  it('listAllNotes returns every note with its highlighted passage, newest first', () => {
    const h = highlight({ text: 'the passage' })
    repo.upsertHighlight(h)
    repo.upsertNote(
      note({ anchor: { highlightId: h.id }, body: 'on the passage', updatedAt: 2000 })
    )
    repo.upsertNote(note({ page: 9, body: 'free note', updatedAt: 3000 }))
    expect(repo.listAllNotes().map((r) => [r.note.body, r.quote, r.note.bookId])).toEqual([
      ['free note', null, bookId],
      ['on the passage', 'the passage', bookId]
    ])
  })
})
