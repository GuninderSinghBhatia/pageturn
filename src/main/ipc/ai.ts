import { ipcMain } from 'electron'
import { ProviderSchema, type AiError } from '@shared/ai'
import { Channels } from '@shared/ipc'
import { parse } from './validate'

/** AI handlers. Until providers exist (Task 3) "Test key" reports that it is not implemented. */
export function registerAiIpc(): void {
  ipcMain.handle(Channels.aiTestKey, (_e, p: unknown) => {
    parse(ProviderSchema, p)
    const error: AiError = { kind: 'provider', message: 'Not implemented' }
    return { ok: false, error }
  })
}
