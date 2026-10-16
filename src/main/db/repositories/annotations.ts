import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BookAnnotations,
  Bookmark,
  Highlight,
  HighlightColor,
  HighlightStyle,
  Note
} from '@shared/types'

type HighlightRow = {
  id: string
  book_id: string
  page: number
  rects_json: string
  text: string
  color: string
  style: string
  note_id: string | null
  created_at: number
  updated_at: number
}
type NoteRow = {
  id: string
  book_id: string
  page: number
  anchor_json: string
  body: string
  created_at: number
  updated_at: number
}
type BookmarkRow = {
  id: string
  book_id: string
  page: number
  label: string | null
  created_at: number
}

const toHighlight = (r: HighlightRow): Highlight => ({
  id: r.id,
  bookId: r.book_id,
  page: r.page,
  rects: JSON.parse(r.rects_json),
  text: r.text,
  color: r.color as HighlightColor,
  style: (r.style ?? 'highlight') as HighlightStyle,
  noteId: r.note_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  bookId: r.book_id,
  page: r.page,
  anchor: JSON.parse(r.anchor_json),
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toBookmark = (r: BookmarkRow): Bookmark => ({
  id: r.id,
  bookId: r.book_id,
  page: r.page,
  label: r.label,
  createdAt: r.created_at
})

/** Highlights, notes and bookmarks (ink lives in InkRepo). */
export class AnnotationsRepo {
  constructor(private db: Database.Database) {}

  listForBook(bookId: string): Omit<BookAnnotations, 'ink'> {
    const all = <T>(table: string): T[] =>
      this.db
        .prepare(`SELECT * FROM ${table} WHERE book_id = ? ORDER BY page, created_at`)
        .all(bookId) as T[]
    return {
      highlights: all<HighlightRow>('highlights').map(toHighlight),
      notes: all<NoteRow>('notes').map(toNote),
      bookmarks: all<BookmarkRow>('bookmarks').map(toBookmark)
    }
  }

  upsertHighlight(h: Highlight): void {
    this.db
      .prepare(
        `INSERT INTO highlights (id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at)
         VALUES (@id, @bookId, @page, @rects, @text, @color, @style, @noteId, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET rects_json = excluded.rects_json, text = excluded.text,
           color = excluded.color, style = excluded.style, note_id = excluded.note_id, updated_at = excluded.updated_at`
      )
      .run({ ...h, rects: JSON.stringify(h.rects) })
  }

  /** Deletes a highlight together with its note. */
  deleteHighlight(id: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT note_id FROM highlights WHERE id = ?').get(id) as
        { note_id: string | null } | undefined
      if (row?.note_id) this.db.prepare('DELETE FROM notes WHERE id = ?').run(row.note_id)
      this.db
        .prepare("DELETE FROM notes WHERE json_extract(anchor_json, '$.highlightId') = ?")
        .run(id)
      this.db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
    })()
  }

  /** Inserts or updates a note; a highlight anchor gets its note_id pointed at this note. */
  upsertNote(n: Note): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at)
           VALUES (@id, @bookId, @page, @anchor, @body, @createdAt, @updatedAt)
           ON CONFLICT(id) DO UPDATE SET anchor_json = excluded.anchor_json, body = excluded.body,
             updated_at = excluded.updated_at`
        )
        .run({ ...n, anchor: JSON.stringify(n.anchor) })
      if (n.anchor.highlightId) {
        this.db
          .prepare('UPDATE highlights SET note_id = ? WHERE id = ?')
          .run(n.id, n.anchor.highlightId)
      }
    })()
  }

  deleteNote(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE highlights SET note_id = NULL WHERE note_id = ?').run(id)
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    })()
  }

  /** Adds a bookmark on the page, or removes the existing one (returns null). */
  toggleBookmark(
    bookId: string,
    page: number,
    label: string | null = null,
    id: string = randomUUID()
  ): Bookmark | null {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT id FROM bookmarks WHERE book_id = ? AND page = ?')
        .get(bookId, page)
      if (existing) {
        this.db.prepare('DELETE FROM bookmarks WHERE book_id = ? AND page = ?').run(bookId, page)
        return null
      }
      const b: Bookmark = { id, bookId, page, label, createdAt: Date.now() }
      this.db
        .prepare(
          'INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES (@id, @bookId, @page, @label, @createdAt)'
        )
        .run(b)
      return b
    })()
  }

  renameBookmark(id: string, label: string | null): void {
    this.db.prepare('UPDATE bookmarks SET label = ? WHERE id = ?').run(label, id)
  }

  /** Every note in the library, newest first, with the passage of its highlight (if any). */
  listAllNotes(): { note: Note; quote: string | null }[] {
    const rows = this.db
      .prepare(
        `SELECT notes.*, highlights.text AS quote FROM notes
         LEFT JOIN highlights ON highlights.id = json_extract(notes.anchor_json, '$.highlightId')
         ORDER BY notes.updated_at DESC`
      )
      .all() as (NoteRow & { quote: string | null })[]
    return rows.map((r) => ({ note: toNote(r), quote: r.quote }))
  }

  deleteAllForBook(bookId: string): void {
    this.db.transaction(() => {
      for (const t of ['highlights', 'notes', 'bookmarks', 'ink_strokes']) {
        this.db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(bookId)
      }
    })()
  }
}
