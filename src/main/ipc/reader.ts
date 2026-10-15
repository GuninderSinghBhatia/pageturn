import { ipcMain } from 'electron'
import { BookIdSchema, Channels, PageSchema } from '@shared/ipc'
import type { BooksRepo } from '../db/repositories/books'
import { parse } from './validate'

export function registerReaderIpc(repo: BooksRepo): void {
  ipcMain.handle(Channels.readerSaveProgress, (_e, id: unknown, page: unknown) => {
    repo.setProgress(parse(BookIdSchema, id), parse(PageSchema, page))
  })
}
