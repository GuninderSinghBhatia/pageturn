import { ipcMain, type BrowserWindow } from 'electron'
import {
  DEFAULT_MODELS,
  ExplainRequestSchema,
  FollowUpSchema,
  ProviderSchema,
  chatModels,
  RequestIdSchema,
  type AiError
} from '@shared/ai'
import { Channels } from '@shared/ipc'
import { AiSessionManager } from '../ai/session'
import { aiError, getProvider, toAiError } from '../ai/provider'
import type { SettingsRepo } from '../db/repositories/settings'
import type { SecretStore } from '../secrets'
import { parse } from './validate'

/** AI handlers: explanations stream back as ai:token / ai:done / ai:error events. */
export function registerAiIpc(
  win: BrowserWindow,
  settings: SettingsRepo,
  secrets: SecretStore
): AiSessionManager {
  const sessions = new AiSessionManager({
    secrets,
    settings,
    send: (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  })

  ipcMain.handle(Channels.aiExplain, (_e, id: unknown, req: unknown) => {
    void sessions.explain(parse(RequestIdSchema, id), parse(ExplainRequestSchema, req))
  })
  ipcMain.handle(Channels.aiFollowUp, (_e, id: unknown, text: unknown) => {
    void sessions.followUp(parse(RequestIdSchema, id), parse(FollowUpSchema, text))
  })
  ipcMain.handle(Channels.aiCancel, (_e, id: unknown) =>
    sessions.cancel(parse(RequestIdSchema, id))
  )

  ipcMain.handle(Channels.aiListModels, async (_e, p: unknown): Promise<string[]> => {
    const provider = parse(ProviderSchema, p)
    const key = secrets.get(provider)
    if (!key) return []
    try {
      return chatModels(provider, await getProvider(provider).listModels(key))
    } catch {
      return [] // offline or a bad key: the built-in list still works
    }
  })

  ipcMain.handle(
    Channels.aiTestKey,
    async (_e, p: unknown): Promise<{ ok: true } | { ok: false; error: AiError }> => {
      const provider = parse(ProviderSchema, p)
      const key = secrets.get(provider)
      if (!key) return { ok: false, error: aiError('no_key') }
      const model = settings.get().aiModel || DEFAULT_MODELS[provider]
      try {
        await getProvider(provider).test(key, model)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: toAiError(err) }
      }
    }
  )

  // A reload or crashed page has no panel left to receive tokens.
  win.webContents.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) sessions.cancelAll()
  })
  win.webContents.on('render-process-gone', () => sessions.cancelAll())
  return sessions
}
