import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BookIdSchema, BookMetaSchema, Channels, PathsSchema, PngSchema } from '@shared/ipc'
import type { Book } from '@shared/types'
import type { BooksRepo } from '../db/repositories/books'
import {
  BookMissingError,
  importFiles,
  relocateBook,
  thumbnailPath,
  toBook
} from '../library/import'
import { parse } from './validate'

export function thumbDir(): string {
  return join(app.getPath('userData'), 'thumbnails')
}

/** Tells every window the library contents changed so views can refresh. */
function notifyChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(Channels.libraryChanged)
}

export async function importAsBooks(repo: BooksRepo, paths: string[]): Promise<Book[]> {
  const rows = await importFiles(repo, parse(PathsSchema, paths))
  notifyChanged()
  return rows.map((r) => toBook(r, existsSync, thumbDir()))
}

export function registerLibraryIpc(repo: BooksRepo, win: BrowserWindow): void {
  const getRow = (id: unknown): NonNullable<ReturnType<BooksRepo['get']>> => {
    const row = repo.get(parse(BookIdSchema, id))
    if (!row) throw new Error('Unknown book')
    return row
  }

  ipcMain.handle(Channels.libraryList, () =>
    repo.list().map((r) => toBook(r, existsSync, thumbDir()))
  )

  ipcMain.handle(Channels.libraryImport, (_e, paths: unknown) =>
    importAsBooks(repo, paths as string[])
  )

  ipcMain.handle(Channels.libraryOpenDialog, async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return res.canceled || res.filePaths.length === 0 ? [] : importAsBooks(repo, res.filePaths)
  })

  ipcMain.handle(Channels.librarySetLiked, (_e, id: unknown, liked: unknown) => {
    repo.setLiked(getRow(id).id, parse(z.boolean(), liked))
  })

  ipcMain.handle(Channels.libraryRemove, async (_e, id: unknown, deleteAnnotations: unknown) => {
    const row = getRow(id)
    if (parse(z.boolean(), deleteAnnotations)) repo.purge(row.id)
    else repo.hide(row.id)
    await rm(thumbnailPath(thumbDir(), row.id), { force: true })
    notifyChanged()
  })

  ipcMain.handle(Channels.libraryRelocate, async (_e, id: unknown) => {
    const row = getRow(id)
    const res = await dialog.showOpenDialog(win, {
      title: 'Locate the moved PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    if ((await relocateBook(repo, row.id, res.filePaths[0])) === 'mismatch') {
      await dialog.showMessageBox(win, {
        type: 'warning',
        message: 'That file is a different PDF.',
        detail: 'Choose the same document that was originally imported.'
      })
      return null
    }
    notifyChanged()
    return toBook(repo.get(row.id)!, existsSync, thumbDir())
  })

  ipcMain.handle(Channels.libraryGetFile, async (_e, id: unknown) => {
    const row = getRow(id)
    if (!existsSync(row.path)) throw new BookMissingError(row.id)
    const buf = await readFile(row.path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle(Channels.librarySaveThumbnail, async (_e, id: unknown, png: unknown) => {
    const row = getRow(id)
    const bytes = Buffer.from(parse(PngSchema, png))
    await mkdir(thumbDir(), { recursive: true })
    await writeFile(thumbnailPath(thumbDir(), row.id), bytes)
    return `data:image/png;base64,${bytes.toString('base64')}`
  })

  ipcMain.handle(Channels.libraryUpdateMeta, (_e, id: unknown, meta: unknown) => {
    repo.updateMeta(getRow(id).id, parse(BookMetaSchema, meta))
  })
}
