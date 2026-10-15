import { ipcMain } from 'electron'
import { Channels, SettingsPartialSchema } from '@shared/ipc'
import type { SettingsRepo } from '../db/repositories/settings'
import { parse } from './validate'

export function registerSettingsIpc(repo: SettingsRepo): void {
  ipcMain.handle(Channels.settingsGet, () => repo.get())
  ipcMain.handle(Channels.settingsSet, (_e, partial: unknown) =>
    repo.set(parse(SettingsPartialSchema, partial))
  )
}
