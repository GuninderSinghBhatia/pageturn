import { ipcMain } from 'electron'
import {
  BookIdSchema,
  BookmarkLabelSchema,
  Channels,
  HighlightSchema,
  IdSchema,
  InkIdsSchema,
  InkStrokesSchema,
  NoteSchema,
  NoteTagsSchema,
  PageSchema
} from '@shared/ipc'
import { existsSync } from 'node:fs'
import type { NotesGroup } from '@shared/ipc'
import type { BookAnnotations } from '@shared/types'
import { toBook } from '../library/import'
import { thumbDir } from './library'
import type { AnnotationsRepo } from '../db/repositories/annotations'
import type { BooksRepo } from '../db/repositories/books'
import type { InkRepo } from '../db/repositories/ink'
import { withRetry } from '../db/retry'
import { parse } from './validate'

export function registerAnnotationsIpc(
  annotations: AnnotationsRepo,
  ink: InkRepo,
  books: BooksRepo
): void {
  /** Writes must target a book row that exists (hidden books included). */
  const known = (bookId: string): string => {
    if (!books.get(bookId)) throw new Error('Invalid payload')
    return bookId
  }

  ipcMain.handle(Channels.annotationsList, (_e, id: unknown): BookAnnotations => {
    const bookId = parse(BookIdSchema, id)
    return { ...annotations.listForBook(bookId), ink: ink.listForBook(bookId) }
  })

  ipcMain.handle(Channels.annotationsUpsertHighlight, (_e, h: unknown) => {
    const hl = parse(HighlightSchema, h)
    known(hl.bookId)
    return withRetry(() => annotations.upsertHighlight(hl))
  })
  ipcMain.handle(Channels.annotationsDeleteHighlight, (_e, id: unknown) => {
    const hid = parse(IdSchema, id)
    return withRetry(() => annotations.deleteHighlight(hid))
  })

  ipcMain.handle(Channels.annotationsUpsertNote, (_e, n: unknown) => {
    const note = parse(NoteSchema, n)
    known(note.bookId)
    return withRetry(() => annotations.upsertNote(note))
  })
  ipcMain.handle(Channels.annotationsDeleteNote, (_e, id: unknown) => {
    const nid = parse(IdSchema, id)
    return withRetry(() => annotations.deleteNote(nid))
  })

  ipcMain.handle(Channels.annotationsSetNoteTags, (_e, id: unknown, tags: unknown) =>
    annotations.setNoteTags(parse(IdSchema, id), parse(NoteTagsSchema, tags))
  )

  ipcMain.handle(Channels.annotationsAddInk, (_e, strokes: unknown) => {
    const list = parse(InkStrokesSchema, strokes)
    for (const s of list) known(s.bookId)
    return withRetry(() => ink.add(list))
  })
  ipcMain.handle(Channels.annotationsDeleteInk, (_e, ids: unknown) => {
    const list = parse(InkIdsSchema, ids)
    return withRetry(() => ink.delete(list))
  })

  ipcMain.handle(
    Channels.annotationsToggleBookmark,
    (_e, bookId: unknown, page: unknown, label: unknown, id: unknown) =>
      annotations.toggleBookmark(
        known(parse(BookIdSchema, bookId)),
        parse(PageSchema, page),
        parse(BookmarkLabelSchema, label) ?? null,
        id === undefined || id === null ? undefined : parse(IdSchema, id)
      )
  )

  // Notes for the home page: grouped by book in order of each book's newest note; books that
  // were removed from the library are left out.
  ipcMain.handle(Channels.annotationsListAllNotes, (): NotesGroup[] => {
    const visible = new Map(books.list().map((b) => [b.id, b]))
    const groups = new Map<string, NotesGroup>()
    for (const row of annotations.listAllNotes()) {
      const book = visible.get(row.note.bookId)
      if (!book) continue
      let g = groups.get(book.id)
      if (!g) groups.set(book.id, (g = { book: toBook(book, existsSync, thumbDir()), notes: [] }))
      g.notes.push(row)
    }
    return [...groups.values()]
  })

  ipcMain.handle(Channels.annotationsRenameBookmark, (_e, id: unknown, label: unknown) =>
    annotations.renameBookmark(parse(IdSchema, id), parse(BookmarkLabelSchema, label) ?? null)
  )
}
