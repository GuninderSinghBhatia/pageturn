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
  PageSchema
} from '@shared/ipc'
import type { BookAnnotations } from '@shared/types'
import type { AnnotationsRepo } from '../db/repositories/annotations'
import type { BooksRepo } from '../db/repositories/books'
import type { InkRepo } from '../db/repositories/ink'
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
    annotations.upsertHighlight(hl)
  })
  ipcMain.handle(Channels.annotationsDeleteHighlight, (_e, id: unknown) =>
    annotations.deleteHighlight(parse(IdSchema, id))
  )

  ipcMain.handle(Channels.annotationsUpsertNote, (_e, n: unknown) => {
    const note = parse(NoteSchema, n)
    known(note.bookId)
    annotations.upsertNote(note)
  })
  ipcMain.handle(Channels.annotationsDeleteNote, (_e, id: unknown) =>
    annotations.deleteNote(parse(IdSchema, id))
  )

  ipcMain.handle(Channels.annotationsAddInk, (_e, strokes: unknown) => {
    const list = parse(InkStrokesSchema, strokes)
    for (const s of list) known(s.bookId)
    ink.add(list)
  })
  ipcMain.handle(Channels.annotationsDeleteInk, (_e, ids: unknown) =>
    ink.delete(parse(InkIdsSchema, ids))
  )

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
}
