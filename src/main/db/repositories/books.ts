import type Database from 'better-sqlite3'
import type { Book } from '@shared/types'

export type BookRow = Omit<Book, 'missing' | 'thumbnailUrl'>

export type BookUpsert = {
  id: string
  path: string
  title?: string | null
  author?: string | null
  numPages?: number | null
}

export type BookMetaUpdate = { title?: string | null; author?: string | null; numPages: number }

type DbRow = {
  id: string
  path: string
  title: string | null
  author: string | null
  num_pages: number | null
  last_page: number
  added_at: number
  last_opened_at: number | null
  liked: number
}

const toRow = (r: DbRow): BookRow => ({
  id: r.id,
  path: r.path,
  title: r.title,
  author: r.author,
  numPages: r.num_pages,
  lastPage: r.last_page,
  addedAt: r.added_at,
  lastOpenedAt: r.last_opened_at,
  liked: r.liked === 1
})

export class BooksRepo {
  constructor(private db: Database.Database) {}

  /** Inserts a new book, or updates path (and any provided metadata) of an existing one. */
  upsert(row: BookUpsert): void {
    this.db
      .prepare(
        `INSERT INTO books (id, path, title, author, num_pages, last_page, added_at)
         VALUES (@id, @path, @title, @author, @numPages, 1, @now)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           removed_at = NULL,
           title = COALESCE(excluded.title, title),
           author = COALESCE(excluded.author, author),
           num_pages = COALESCE(excluded.num_pages, num_pages)`
      )
      .run({
        id: row.id,
        path: row.path,
        title: row.title ?? null,
        author: row.author ?? null,
        numPages: row.numPages ?? null,
        now: Date.now()
      })
  }

  get(id: string): BookRow | null {
    const r = this.db.prepare('SELECT * FROM books WHERE id = ?').get(id) as DbRow | undefined
    return r ? toRow(r) : null
  }

  list(): BookRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM books WHERE removed_at IS NULL
         ORDER BY last_opened_at DESC NULLS LAST, added_at DESC`
      )
      .all() as DbRow[]
    return rows.map(toRow)
  }

  setPath(id: string, path: string): void {
    this.db.prepare('UPDATE books SET path = ? WHERE id = ?').run(path, id)
  }

  setProgress(id: string, page: number): void {
    this.db
      .prepare('UPDATE books SET last_page = ?, last_opened_at = ? WHERE id = ?')
      .run(page, Date.now(), id)
  }

  updateMeta(id: string, meta: BookMetaUpdate): void {
    const cur = this.get(id)
    if (!cur) return
    this.db
      .prepare('UPDATE books SET title = ?, author = ?, num_pages = ? WHERE id = ?')
      .run(
        meta.title === undefined ? cur.title : meta.title,
        meta.author === undefined ? cur.author : meta.author,
        meta.numPages,
        id
      )
  }

  setLiked(id: string, liked: boolean): void {
    this.db.prepare('UPDATE books SET liked = ? WHERE id = ?').run(liked ? 1 : 0, id)
  }

  /** Removes from the library but keeps annotations; re-importing (upsert) restores it. */
  hide(id: string): void {
    this.db.prepare('UPDATE books SET removed_at = ? WHERE id = ?').run(Date.now(), id)
  }

  /** Deletes the book and (via ON DELETE CASCADE) all of its annotations. */
  purge(id: string): void {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id)
  }
}
