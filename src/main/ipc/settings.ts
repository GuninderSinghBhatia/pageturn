import { ipcMain } from 'electron'
import { ApiKeySchema, ProviderSchema } from '@shared/ai'
import { Channels, SettingsPartialSchema } from '@shared/ipc'
import type { SettingsRepo } from '../db/repositories/settings'
import type { SecretStore } from '../secrets'
import { parse } from './validate'

export function registerSettingsIpc(repo: SettingsRepo, secrets: SecretStore): void {
  ipcMain.handle(Channels.settingsGet, () => repo.get())
  ipcMain.handle(Channels.settingsSet, (_e, partial: unknown) =>
    repo.set(parse(SettingsPartialSchema, partial))
  )
  // API keys stay in main: the renderer can store, clear or ask about a key, never read it.
  ipcMain.handle(Channels.settingsSetApiKey, (_e, p: unknown, key: unknown) =>
    secrets.set(parse(ProviderSchema, p), parse(ApiKeySchema, key))
  )
  ipcMain.handle(Channels.settingsHasApiKey, (_e, p: unknown) =>
    secrets.has(parse(ProviderSchema, p))
  )
  ipcMain.handle(Channels.settingsClearApiKey, (_e, p: unknown) =>
    secrets.clear(parse(ProviderSchema, p))
  )
}
