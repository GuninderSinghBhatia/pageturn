import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { basename, extname } from 'node:path'
import { BookIdSchema, Channels } from '@shared/ipc'
import type { AnnotationsRepo } from '../db/repositories/annotations'
import type { BookRow, BooksRepo } from '../db/repositories/books'
import type { InkRepo } from '../db/repositories/ink'
import { createBackup, mergeBackup, parseBackup } from '../export/backup'
import { renderMarkdown } from '../export/markdown'
import { parse } from './validate'

export const titleOf = (row: BookRow): string =>
  row.title?.trim() || basename(row.path, extname(row.path))

const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'notes'

/**
 * Where to save: the dialog's choice, or PAGETURN_SAVE_PATH (tests and scripted exports
 * skip the native dialog). Null when the dialog is cancelled.
 */
export async function chooseSavePath(
  win: BrowserWindow,
  defaultName: string,
  filters: Electron.FileFilter[]
): Promise<string | null> {
  if (process.env.PAGETURN_SAVE_PATH) return process.env.PAGETURN_SAVE_PATH
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
  return r.canceled || !r.filePath ? null : r.filePath
}

/** Markdown export of a book's annotations (save to file, or text for "Copy all"). */
export function registerExportIpc(
  win: BrowserWindow,
  books: BooksRepo,
  annotations: AnnotationsRepo,
  ink: InkRepo
): void {
  const markdownFor = (id: unknown): { md: string; title: string } => {
    const row = books.get(parse(BookIdSchema, id))
    if (!row) throw new Error('Unknown book')
    const a = annotations.listForBook(row.id)
    const inkPages = [...new Set(ink.listForBook(row.id).map((s) => s.page))]
    const title = titleOf(row)
    return { md: renderMarkdown({ title, ...a, inkPages }), title }
  }

  ipcMain.handle(Channels.exportMarkdownText, (_e, id: unknown) => markdownFor(id).md)
  ipcMain.handle(Channels.exportMarkdown, async (_e, id: unknown) => {
    const { md, title } = markdownFor(id)
    const path = await chooseSavePath(win, `${safeFileName(title)}-notes.md`, [
      { name: 'Markdown', extensions: ['md'] }
    ])
    if (!path) return { saved: false }
    writeFileSync(path, md, 'utf8')
    return { saved: true, path }
  })
}

/** File to import: the open dialog's choice, or PAGETURN_OPEN_PATH / PAGETURN_SAVE_PATH (tests). */
async function chooseOpenPath(win: BrowserWindow): Promise<string | null> {
  const preset = process.env.PAGETURN_OPEN_PATH ?? process.env.PAGETURN_SAVE_PATH
  if (preset) return preset
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'PageTurn backup', extensions: ['json'] }]
  })
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

const today = (): string => new Date().toISOString().slice(0, 10)

/** Manual backup export / import and the data folder (Settings → Data). */
export function registerBackupIpc(win: BrowserWindow, db: Database.Database): void {
  ipcMain.handle(Channels.exportBackup, async () => {
    const path = await chooseSavePath(win, `pageturn-backup-${today()}.json`, [
      { name: 'PageTurn backup', extensions: ['json'] }
    ])
    if (!path) return { saved: false }
    writeFileSync(path, JSON.stringify(createBackup(db), null, 1), 'utf8')
    return { saved: true, path }
  })
  ipcMain.handle(Channels.exportImportBackup, async () => {
    const path = await chooseOpenPath(win)
    if (!path) return { error: 'cancelled' }
    try {
      const result = mergeBackup(db, parseBackup(readFileSync(path, 'utf8')))
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(Channels.libraryChanged)
      return result
    } catch (err) {
      const msg =
        (err as Error).name === 'BackupVersionError'
          ? (err as Error).message
          : 'That file is not a PageTurn backup.'
      return { error: msg }
    }
  })
  ipcMain.handle(Channels.exportOpenDataFolder, async () => {
    await shell.openPath(app.getPath('userData'))
  })
}
