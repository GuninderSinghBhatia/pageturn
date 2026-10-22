import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'

export const BACKUP_VERSION = 1

export class BackupVersionError extends Error {
  constructor() {
    super('This backup was made by a newer version of PageTurn.')
    this.name = 'BackupVersionError'
  }
}

// Rows are stored as the database has them (snake_case columns). Ink points stay exact:
// the stroke blob is kept as base64.
const n = z.number()
const nn = z.number().nullable()
const s = z.string()
const sn = z.string().nullable()
const BookRow = z.object({
  id: s,
  path: s,
  title: sn,
  author: sn,
  num_pages: nn,
  last_page: nn,
  added_at: nn,
  last_opened_at: nn,
  removed_at: nn.optional(),
  liked: n.optional()
})
const HighlightRow = z.object({
  id: s,
  book_id: s,
  page: n,
  rects_json: s,
  text: s,
  color: s,
  style: s.optional(),
  note_id: sn,
  created_at: n,
  updated_at: n
})
const NoteRow = z.object({
  id: s,
  book_id: s,
  page: n,
  anchor_json: s,
  body: s,
  tags_json: s.optional(),
  created_at: n,
  updated_at: n
})
const InkRow = z.object({
  id: s,
  book_id: s,
  page: n,
  points_b64: s,
  color: s,
  width: n,
  tool: s,
  created_at: n
})
const BookmarkRow = z.object({ id: s, book_id: s, page: n, label: sn, created_at: n })

const BackupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  createdAt: n,
  books: z.array(BookRow),
  highlights: z.array(HighlightRow),
  notes: z.array(NoteRow),
  ink: z.array(InkRow),
  bookmarks: z.array(BookmarkRow),
  settings: z.record(z.string(), z.unknown())
})
export type Backup = z.infer<typeof BackupSchema>

const all = <T>(db: Database.Database, sql: string): T[] => db.prepare(sql).all() as T[]

/** Everything in the library database. API keys live in secrets.bin and are never included. */
export function createBackup(db: Database.Database): Backup {
  const settings: Record<string, unknown> = {}
  for (const r of all<{ key: string; value_json: string }>(
    db,
    'SELECT key, value_json FROM settings'
  )) {
    settings[r.key] = JSON.parse(r.value_json)
  }
  return {
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    books: all(
      db,
      'SELECT id, path, title, author, num_pages, last_page, added_at, last_opened_at, removed_at, liked FROM books'
    ),
    highlights: all(
      db,
      'SELECT id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at FROM highlights'
    ),
    notes: all(
      db,
      'SELECT id, book_id, page, anchor_json, body, tags_json, created_at, updated_at FROM notes'
    ),
    ink: all<Omit<z.infer<typeof InkRow>, 'points_b64'> & { points_blob: Buffer }>(
      db,
      'SELECT id, book_id, page, points_blob, color, width, tool, created_at FROM ink_strokes'
    ).map(({ points_blob, ...r }) => ({
      ...r,
      points_b64: Buffer.from(points_blob).toString('base64')
    })),
    bookmarks: all(db, 'SELECT id, book_id, page, label, created_at FROM bookmarks'),
    settings
  }
}

/** Validates a backup file. A version this app does not know is refused. */
export function parseBackup(json: string): Backup {
  const raw = JSON.parse(json) as { version?: unknown }
  if (raw?.version !== BACKUP_VERSION) throw new BackupVersionError()
  return BackupSchema.parse(raw)
}

/**
 * Merges a backup into the library in one transaction. Rows are matched by id; an existing
 * highlight or note is replaced only when the backup's copy was updated more recently.
 */
export function mergeBackup(
  db: Database.Database,
  b: Backup
): { added: number; updated: number; skipped: number } {
  let added = 0
  let updated = 0
  let skipped = 0
  const exists = (table: string, id: string): { ts: number } | undefined =>
    db
      .prepare(
        `SELECT ${table === 'highlights' || table === 'notes' ? 'updated_at' : '0'} AS ts FROM ${table} WHERE id = ?`
      )
      .get(id) as { ts: number } | undefined

  db.transaction(() => {
    for (const r of b.books) {
      const cur = db.prepare('SELECT last_opened_at FROM books WHERE id = ?').get(r.id) as
        { last_opened_at: number | null } | undefined
      if (!cur) {
        db.prepare(
          `INSERT INTO books (id, path, title, author, num_pages, last_page, added_at, last_opened_at, removed_at, liked)
           VALUES (@id, @path, @title, @author, @num_pages, @last_page, @added_at, @last_opened_at, @removed_at, @liked)`
        ).run({ removed_at: null, liked: 0, ...r })
        added++
      } else if ((r.last_opened_at ?? 0) > (cur.last_opened_at ?? 0)) {
        db.prepare('UPDATE books SET last_page = ?, last_opened_at = ? WHERE id = ?').run(
          r.last_page,
          r.last_opened_at,
          r.id
        )
        updated++
      } else skipped++
    }

    const upsert = (
      table: 'highlights' | 'notes',
      row: Record<string, unknown>,
      sql: string
    ): void => {
      const cur = exists(table, row.id as string)
      if (!cur) {
        db.prepare(`INSERT INTO ${sql}`).run(row)
        added++
      } else if ((row.updated_at as number) > cur.ts) {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id)
        db.prepare(`INSERT INTO ${sql}`).run(row)
        updated++
      } else skipped++
    }
    for (const r of b.highlights) {
      upsert(
        'highlights',
        { style: 'highlight', ...r },
        `highlights (id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at)
         VALUES (@id, @book_id, @page, @rects_json, @text, @color, @style, @note_id, @created_at, @updated_at)`
      )
    }
    for (const r of b.notes) {
      upsert(
        'notes',
        { tags_json: '[]', ...r },
        `notes (id, book_id, page, anchor_json, body, tags_json, created_at, updated_at)
         VALUES (@id, @book_id, @page, @anchor_json, @body, @tags_json, @created_at, @updated_at)`
      )
    }
    // Strokes and bookmarks never change once made: add the missing ones.
    for (const { points_b64, ...r } of b.ink) {
      if (exists('ink_strokes', r.id)) {
        skipped++
        continue
      }
      db.prepare(
        `INSERT INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
         VALUES (@id, @book_id, @page, @points_blob, @color, @width, @tool, @created_at)`
      ).run({ ...r, points_blob: Buffer.from(points_b64, 'base64') })
      added++
    }
    for (const r of b.bookmarks) {
      if (exists('bookmarks', r.id)) {
        skipped++
        continue
      }
      db.prepare(
        'INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES (@id, @book_id, @page, @label, @created_at)'
      ).run(r)
      added++
    }
    // Preferences: fill in what this install has not set; never overwrite current choices.
    const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value_json) VALUES (?, ?)')
    for (const [k, v] of Object.entries(b.settings)) setting.run(k, JSON.stringify(v))
  })()
  return { added, updated, skipped }
}

const FILE_RE = /^pageturn-\d{4}-\d{2}-\d{2}\.json$/
const dayStamp = (ms: number): string => {
  const d = new Date(ms)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Deletes the oldest dated backups beyond `keep`. Other files are left alone. */
export function rotateBackups(dir: string, keep = 7): void {
  const files = readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f))
}

/**
 * Writes today's backup (pageturn-YYYY-MM-DD.json) if there is none yet, then checks again
 * every 24 h. Returns a function that stops the schedule.
 */
export function scheduleDailyBackup(
  db: Database.Database,
  dir: string,
  now: () => number = Date.now
): () => void {
  const run = (): void => {
    try {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `pageturn-${dayStamp(now())}.json`)
      if (existsSync(file)) return
      writeFileSync(file, JSON.stringify(createBackup(db)))
      rotateBackups(dir)
    } catch (err) {
      console.error('Daily backup failed', err)
    }
  }
  run()
  const timer = setInterval(run, 24 * 3600_000)
  timer.unref?.()
  return () => clearInterval(timer)
}
