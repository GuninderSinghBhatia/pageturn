import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Highlight } from '@shared/types'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))

import { Channels } from '@shared/ipc'
import { openDb } from '../../../src/main/db/connection'
import { BooksRepo } from '../../../src/main/db/repositories/books'
import { AnnotationsRepo } from '../../../src/main/db/repositories/annotations'
import { InkRepo } from '../../../src/main/db/repositories/ink'
import { registerAnnotationsIpc } from '../../../src/main/ipc/annotations'

const bookId = 'a'.repeat(64)
let db: Database.Database

const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!({}, ...args)

const highlight = (over: Partial<Highlight> = {}): Highlight => ({
  id: randomUUID(),
  bookId,
  page: 2,
  rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }],
  text: 'Lorem',
  color: 'yellow',
  style: 'highlight',
  noteId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over
})

beforeEach(() => {
  handlers.clear()
  db = openDb(':memory:')
  const books = new BooksRepo(db)
  books.upsert({ id: bookId, path: 'C:\\a.pdf' })
  registerAnnotationsIpc(new AnnotationsRepo(db), new InkRepo(db), books)
})
afterEach(() => db.close())

describe('annotations IPC', () => {
  it('rejects payloads with unknown keys', () => {
    expect(() => call(Channels.annotationsUpsertHighlight, { ...highlight(), extra: 1 })).toThrow(
      'Invalid payload'
    )
  })

  it('rejects writes for a book that is not in the library', () => {
    expect(() =>
      call(Channels.annotationsUpsertHighlight, highlight({ bookId: 'b'.repeat(64) }))
    ).toThrow('Invalid payload')
  })

  it('persists a valid highlight and lists it with ink and bookmarks', () => {
    const h = highlight()
    call(Channels.annotationsUpsertHighlight, h)
    call(Channels.annotationsToggleBookmark, bookId, 4)
    expect(call(Channels.annotationsList, bookId)).toMatchObject({
      highlights: [h],
      notes: [],
      ink: [],
      bookmarks: [{ page: 4 }]
    })
  })

  it('validates ink and deletes strokes by id', () => {
    const s = {
      id: randomUUID(),
      bookId,
      page: 3,
      points: [
        [0.1, 0.1, 0.5],
        [0.2, 0.2, 0.5]
      ],
      color: '#1f1f1f',
      width: 0.005,
      tool: 'pen',
      createdAt: 1
    }
    expect(() => call(Channels.annotationsAddInk, [{ ...s, color: 'red' }])).toThrow()
    call(Channels.annotationsAddInk, [s])
    expect((call(Channels.annotationsList, bookId) as { ink: unknown[] }).ink).toHaveLength(1)
    call(Channels.annotationsDeleteInk, [s.id])
    expect((call(Channels.annotationsList, bookId) as { ink: unknown[] }).ink).toHaveLength(0)
  })
})
