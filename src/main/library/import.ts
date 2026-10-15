import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Book } from '@shared/types'
import type { BookRow, BooksRepo } from '../db/repositories/books'
import { computeBookId } from './hash'

export class BookMissingError extends Error {
  constructor(public bookId: string) {
    super(`Book file is missing: ${bookId}`)
    this.name = 'BookMissingError'
  }
}

/** Imports PDFs by content hash: re-importing (or a renamed copy) updates the stored path. */
export async function importFiles(repo: BooksRepo, paths: string[]): Promise<BookRow[]> {
  const byId = new Map<string, BookRow>()
  for (const path of paths) {
    const id = await computeBookId(path)
    repo.upsert({ id, path })
    byId.set(id, repo.get(id)!)
  }
  return [...byId.values()]
}

/** Points a book at a new file, but only if its content hash matches. */
export async function relocateBook(
  repo: BooksRepo,
  id: string,
  newPath: string
): Promise<'ok' | 'mismatch'> {
  if ((await computeBookId(newPath)) !== id) return 'mismatch'
  repo.setPath(id, newPath)
  return 'ok'
}

export function thumbnailPath(thumbDir: string, bookId: string): string {
  return join(thumbDir, `${bookId}.png`)
}

export function toBook(row: BookRow, fsExists: (path: string) => boolean, thumbDir: string): Book {
  const thumb = thumbnailPath(thumbDir, row.id)
  // CSP forbids file: images, so covers are inlined as data URLs.
  const thumbnailUrl = existsSync(thumb)
    ? `data:image/png;base64,${readFileSync(thumb).toString('base64')}`
    : null
  return { ...row, missing: !fsExists(row.path), thumbnailUrl }
}
