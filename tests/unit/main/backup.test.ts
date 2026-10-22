import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../../src/main/db/connection'
import {
  BackupVersionError,
  createBackup,
  mergeBackup,
  parseBackup,
  rotateBackups,
  scheduleDailyBackup
} from '../../../src/main/export/backup'

const B = 'a'.repeat(64)
const tmp = (): string => mkdtempSync(join(tmpdir(), 'pageturn-backup-'))
const fresh = (): Database.Database => openDb(join(tmp(), 'db.sqlite'))

function seed(db: Database.Database): void {
  db.prepare(
    `INSERT INTO books (id, path, title, author, num_pages, last_page, added_at, last_opened_at, liked)
     VALUES (?, 'C:\\b.pdf', 'Book', 'Ann', 10, 3, 1, 2, 1)`
  ).run(B)
  db.prepare(
    `INSERT INTO highlights (id, book_id, page, rects_json, text, color, note_id, created_at, updated_at, style)
     VALUES ('h1', ?, 2, '[]', 'passage', 'yellow', 'n1', 10, 10, 'highlight')`
  ).run(B)
  db.prepare(
    `INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at, tags_json)
     VALUES ('n1', ?, 2, '{"highlightId":"h1"}', 'old body', 10, 10, '["idea"]')`
  ).run(B)
  db.prepare(
    `INSERT INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
     VALUES ('s1', ?, 4, ?, '#000', 0.005, 'pen', 11)`
  ).run(B, Buffer.from([1, 2, 3, 4]))
  db.prepare(
    `INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES ('b1', ?, 5, 'Here', 12)`
  ).run(B)
  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('theme', '"dark"')`).run()
}

const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('backups', () => {
  it('a backup has every row, and no API keys', () => {
    const db = fresh()
    seed(db)
    const json = JSON.stringify(createBackup(db))
    expect(json).not.toMatch(/apiKey/i)
    expect(json).not.toMatch(/"sk-/)
    const b = parseBackup(json)
    expect(b.version).toBe(1)
    expect([
      b.books.length,
      b.highlights.length,
      b.notes.length,
      b.ink.length,
      b.bookmarks.length
    ]).toEqual([1, 1, 1, 1, 1])
  })

  it('restoring into an empty library recreates everything', () => {
    const src = fresh()
    seed(src)
    const backup = parseBackup(JSON.stringify(createBackup(src)))
    const dst = fresh()
    const r = mergeBackup(dst, backup)
    expect(r.added).toBe(5)
    for (const t of ['books', 'highlights', 'notes', 'ink_strokes', 'bookmarks'])
      expect(count(dst, t)).toBe(1)
    const ink = dst.prepare('SELECT points_blob FROM ink_strokes').get() as { points_blob: Buffer }
    expect([...ink.points_blob]).toEqual([1, 2, 3, 4])
    const note = dst.prepare('SELECT tags_json FROM notes').get() as { tags_json: string }
    expect(note.tags_json).toBe('["idea"]')
    expect(
      (
        dst.prepare("SELECT value_json FROM settings WHERE key='theme'").get() as {
          value_json: string
        }
      ).value_json
    ).toBe('"dark"')
  })

  it('merging keeps whichever copy of a note is newer', () => {
    const db = fresh()
    seed(db)
    const backup = parseBackup(JSON.stringify(createBackup(db)))
    // The library's note is newer than the backup's: kept.
    db.prepare("UPDATE notes SET body = 'newer here', updated_at = 99 WHERE id = 'n1'").run()
    let r = mergeBackup(db, backup)
    expect(r.updated).toBe(0)
    expect(r.skipped).toBeGreaterThanOrEqual(1)
    expect(
      (db.prepare("SELECT body FROM notes WHERE id='n1'").get() as { body: string }).body
    ).toBe('newer here')
    // The backup's copy is newer: replaces it.
    const newer = {
      ...backup,
      notes: backup.notes.map((n) => ({ ...n, body: 'from backup', updated_at: 200 }))
    }
    r = mergeBackup(db, newer)
    expect(r.updated).toBe(1)
    expect(
      (db.prepare("SELECT body FROM notes WHERE id='n1'").get() as { body: string }).body
    ).toBe('from backup')
  })

  it('a backup from a newer version is refused and nothing is written', () => {
    const db = fresh()
    const json = JSON.stringify({ ...createBackup(db), version: 2 })
    expect(() => parseBackup(json)).toThrow(BackupVersionError)
    expect(() => parseBackup(json)).toThrow('This backup was made by a newer version of PageTurn.')
    expect(count(db, 'books')).toBe(0)
  })

  it('keeps the newest 7 daily backups', () => {
    const dir = tmp()
    for (let d = 1; d <= 9; d++) writeFileSync(join(dir, `pageturn-2026-10-0${d}.json`), '{}')
    writeFileSync(join(dir, 'unrelated.txt'), '')
    rotateBackups(dir, 7)
    expect(
      readdirSync(dir)
        .filter((f) => f.startsWith('pageturn-'))
        .sort()
    ).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => `pageturn-2026-10-0${d}.json`))
    expect(readdirSync(dir)).toContain('unrelated.txt')
  })

  it('the daily backup is written once per day', () => {
    const db = fresh()
    seed(db)
    const dir = tmp()
    const day = Date.UTC(2026, 9, 22, 9)
    scheduleDailyBackup(db, dir, () => day)()
    scheduleDailyBackup(db, dir, () => day + 3600_000)()
    expect(readdirSync(dir)).toEqual(['pageturn-2026-10-22.json'])
  })
})
