import { describe, it, expect, beforeEach } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../../src/main/db/connection'
import { BooksRepo } from '../../../src/main/db/repositories/books'
import { computeBookId } from '../../../src/main/library/hash'
import { importFiles, relocateBook, toBook } from '../../../src/main/library/import'

const FIX = join(__dirname, '..', '..', 'fixtures')
const TEXT500 = join(FIX, 'text-500.pdf')
const ODD3 = join(FIX, 'odd-3.pdf')

function expectedId(file: string): string {
  const bytes = readFileSync(file)
  return createHash('sha256')
    .update(bytes.subarray(0, 1024 * 1024))
    .update(String(bytes.length))
    .digest('hex')
}

describe('computeBookId', () => {
  it('is SHA-256 of first 1 MB + size, stable across renames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pageturn-lib-'))
    const renamed = join(dir, 'Renamed Copy.pdf')
    copyFileSync(TEXT500, renamed)
    const id = await computeBookId(TEXT500)
    expect(id).toBe(expectedId(TEXT500))
    expect(await computeBookId(renamed)).toBe(id)
  })

  it('only hashes the first 1 MB of large files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pageturn-lib-'))
    const big = join(dir, 'big.pdf')
    writeFileSync(big, Buffer.alloc(1024 * 1024 + 10, 7))
    expect(await computeBookId(big)).toBe(expectedId(big))
  })
})

describe('import / relocate', () => {
  let repo: BooksRepo
  beforeEach(() => {
    repo = new BooksRepo(openDb(':memory:'))
  })

  it('importing the same file twice yields one row', async () => {
    await importFiles(repo, [TEXT500])
    const rows = await importFiles(repo, [TEXT500])
    expect(rows).toHaveLength(1)
    expect(repo.list()).toHaveLength(1)
  })

  it('importing a renamed copy updates the path instead of duplicating', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pageturn-lib-'))
    const renamed = join(dir, 'other-name.pdf')
    copyFileSync(TEXT500, renamed)
    await importFiles(repo, [TEXT500])
    const [row] = await importFiles(repo, [renamed])
    expect(repo.list()).toHaveLength(1)
    expect(row.path).toBe(renamed)
    expect(repo.get(row.id)!.path).toBe(renamed)
  })

  it('relocate rejects a file whose hash does not match', async () => {
    const [row] = await importFiles(repo, [TEXT500])
    expect(await relocateBook(repo, row.id, ODD3)).toBe('mismatch')
    expect(repo.get(row.id)!.path).toBe(TEXT500)
  })

  it('relocate accepts a matching file and updates the path', async () => {
    const [row] = await importFiles(repo, [TEXT500])
    const dir = mkdtempSync(join(tmpdir(), 'pageturn-lib-'))
    const moved = join(dir, 'moved.pdf')
    copyFileSync(TEXT500, moved)
    expect(await relocateBook(repo, row.id, moved)).toBe('ok')
    expect(repo.get(row.id)!.path).toBe(moved)
  })
})

describe('toBook', () => {
  it('marks missing when the file is absent and inlines the thumbnail as a data URL', () => {
    const thumbDir = mkdtempSync(join(tmpdir(), 'pageturn-thumbs-'))
    mkdirSync(thumbDir, { recursive: true })
    const id = 'f'.repeat(64)
    writeFileSync(join(thumbDir, `${id}.png`), Buffer.from([1, 2, 3]))
    const row = {
      id,
      path: join(thumbDir, 'gone.pdf'),
      title: null,
      author: null,
      numPages: null,
      lastPage: 1,
      addedAt: 1,
      lastOpenedAt: null
    }
    const book = toBook(row, existsSync, thumbDir)
    expect(book.missing).toBe(true)
    expect(book.thumbnailUrl).toBe('data:image/png;base64,AQID')
    expect(
      toBook({ ...row, id: 'e'.repeat(64), path: TEXT500 }, existsSync, thumbDir)
    ).toMatchObject({ missing: false, thumbnailUrl: null })
  })
})
