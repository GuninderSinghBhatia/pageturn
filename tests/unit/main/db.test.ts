import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../../src/main/db/connection'
import { BooksRepo } from '../../../src/main/db/repositories/books'
import { SettingsRepo } from '../../../src/main/db/repositories/settings'
import { DEFAULT_SETTINGS } from '@shared/types'

const idA = 'a'.repeat(64)
const idB = 'b'.repeat(64)
const idC = 'c'.repeat(64)

describe('openDb', () => {
  it('runs migrations idempotently', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pageturn-db-')), 'test.db')
    openDb(file).close()
    const db = openDb(file)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })
})

describe('BooksRepo', () => {
  let db: Database.Database
  let repo: BooksRepo
  beforeEach(() => {
    db = openDb(':memory:')
    repo = new BooksRepo(db)
  })
  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('round-trips upsert → get', () => {
    repo.upsert({ id: idA, path: 'C:\\a.pdf', title: 'A', author: 'Ann', numPages: 10 })
    const row = repo.get(idA)!
    expect(row).toMatchObject({
      id: idA,
      path: 'C:\\a.pdf',
      title: 'A',
      author: 'Ann',
      numPages: 10
    })
    expect(row.lastPage).toBe(1)
    expect(row.addedAt).toBeGreaterThan(0)
    expect(row.lastOpenedAt).toBeNull()
    expect(repo.get(idB)).toBeNull()
  })

  it('upsert of existing id keeps last_page and added_at but updates path', () => {
    repo.upsert({ id: idA, path: 'old.pdf' })
    repo.setProgress(idA, 5)
    const before = repo.get(idA)!
    repo.upsert({ id: idA, path: 'new.pdf' })
    const after = repo.get(idA)!
    expect(after.path).toBe('new.pdf')
    expect(after.lastPage).toBe(5)
    expect(after.addedAt).toBe(before.addedAt)
  })

  it('lists by last_opened_at DESC NULLS LAST, then added_at DESC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    repo.upsert({ id: idA, path: 'a.pdf' })
    vi.setSystemTime(2000)
    repo.upsert({ id: idB, path: 'b.pdf' })
    vi.setSystemTime(3000)
    repo.upsert({ id: idC, path: 'c.pdf' })
    vi.setSystemTime(4000)
    repo.setProgress(idA, 2)
    expect(repo.list().map((b) => b.id)).toEqual([idA, idC, idB])
  })

  it('setProgress sets last_page and last_opened_at', () => {
    repo.upsert({ id: idA, path: 'a.pdf' })
    repo.setProgress(idA, 42)
    const row = repo.get(idA)!
    expect(row.lastPage).toBe(42)
    expect(row.lastOpenedAt).not.toBeNull()
  })

  it('updateMeta, setPath and remove', () => {
    repo.upsert({ id: idA, path: 'a.pdf' })
    repo.updateMeta(idA, { title: 'T', author: null, numPages: 7 })
    repo.setPath(idA, 'moved.pdf')
    expect(repo.get(idA)).toMatchObject({
      title: 'T',
      author: null,
      numPages: 7,
      path: 'moved.pdf'
    })
    repo.remove(idA)
    expect(repo.get(idA)).toBeNull()
  })
})

describe('SettingsRepo', () => {
  it('defaults when empty and persists partial updates', () => {
    const db = openDb(':memory:')
    const repo = new SettingsRepo(db)
    expect(repo.get()).toEqual(DEFAULT_SETTINGS)
    expect(repo.set({ paperTint: 'sepia' })).toEqual({ ...DEFAULT_SETTINGS, paperTint: 'sepia' })
    expect(new SettingsRepo(db).get().paperTint).toBe('sepia')
    db.close()
  })
})
