import { app, safeStorage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { AnnotationsRepo } from '../db/repositories/annotations'
import { BooksRepo } from '../db/repositories/books'
import { InkRepo } from '../db/repositories/ink'
import { SettingsRepo } from '../db/repositories/settings'
import { SecretStore } from '../secrets'
import { registerAiIpc } from './ai'
import { registerAnnotationsIpc } from './annotations'
import { registerBackupIpc, registerExportIpc } from './export'
import { registerLibraryIpc } from './library'
import { registerLookupIpc } from './lookup'
import { registerReaderIpc } from './reader'
import { registerSettingsIpc } from './settings'
import { registerWebIpc } from './web'
import { registerWindowIpc } from './window'

export function registerIpc(db: Database.Database, win: BrowserWindow): void {
  const books = new BooksRepo(db)
  registerLibraryIpc(books, win)
  registerReaderIpc(books)
  const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.bin'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  const settings = new SettingsRepo(db)
  registerSettingsIpc(settings, secrets)
  registerAiIpc(win, settings, secrets)
  registerWebIpc(win, settings)
  const annotations = new AnnotationsRepo(db)
  const ink = new InkRepo(db)
  registerAnnotationsIpc(annotations, ink, books)
  registerExportIpc(win, books, annotations, ink)
  registerBackupIpc(win, db)
  registerWindowIpc(win)
  registerLookupIpc(win)
}
