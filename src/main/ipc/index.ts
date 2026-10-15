import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { BooksRepo } from '../db/repositories/books'
import { SettingsRepo } from '../db/repositories/settings'
import { registerLibraryIpc } from './library'
import { registerReaderIpc } from './reader'
import { registerSettingsIpc } from './settings'

export function registerIpc(db: Database.Database, win: BrowserWindow): void {
  const books = new BooksRepo(db)
  registerLibraryIpc(books, win)
  registerReaderIpc(books)
  registerSettingsIpc(new SettingsRepo(db))
}
