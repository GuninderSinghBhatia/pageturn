import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { AnnotationsRepo } from '../db/repositories/annotations'
import { BooksRepo } from '../db/repositories/books'
import { InkRepo } from '../db/repositories/ink'
import { SettingsRepo } from '../db/repositories/settings'
import { registerAnnotationsIpc } from './annotations'
import { registerLibraryIpc } from './library'
import { registerLookupIpc } from './lookup'
import { registerReaderIpc } from './reader'
import { registerSettingsIpc } from './settings'
import { registerWindowIpc } from './window'

export function registerIpc(db: Database.Database, win: BrowserWindow): void {
  const books = new BooksRepo(db)
  registerLibraryIpc(books, win)
  registerReaderIpc(books)
  registerSettingsIpc(new SettingsRepo(db))
  registerAnnotationsIpc(new AnnotationsRepo(db), new InkRepo(db), books)
  registerWindowIpc(win)
  registerLookupIpc(win)
}
