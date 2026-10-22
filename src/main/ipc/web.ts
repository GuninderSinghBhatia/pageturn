import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { Channels } from '@shared/ipc'
import type { SettingsRepo } from '../db/repositories/settings'
import { SearchViewManager, searchUrl } from '../web/searchView'
import { parse } from './validate'

const BoundsSchema = z
  .object({
    x: z.number().int().min(0).max(20_000),
    y: z.number().int().min(0).max(20_000),
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000)
  })
  .strict()
const QuerySchema = z.string().trim().min(1).max(1000)
const TitleSchema = z.string().max(500).nullable()

/** Web tab handlers: main resolves the query to a search URL from the user's settings. */
export function registerWebIpc(win: BrowserWindow, settings: SettingsRepo): SearchViewManager {
  const view = new SearchViewManager(win)
  view.onState((s) => {
    if (!win.isDestroyed()) win.webContents.send(Channels.webState, s)
  })
  ipcMain.handle(Channels.webShow, (_e, q: unknown, b: unknown, t: unknown) => {
    const s = settings.get()
    view.show(
      searchUrl(s.searchEngine, parse(QuerySchema, q), parse(TitleSchema, t), s.searchIncludeTitle),
      parse(BoundsSchema, b)
    )
  })
  ipcMain.handle(Channels.webReveal, (_e, b: unknown) => view.reveal(parse(BoundsSchema, b)))
  ipcMain.handle(Channels.webSetBounds, (_e, b: unknown) => view.setBounds(parse(BoundsSchema, b)))
  ipcMain.handle(Channels.webHide, () => view.hide())
  ipcMain.handle(Channels.webBack, () => view.back())
  ipcMain.handle(Channels.webForward, () => view.forward())
  ipcMain.handle(Channels.webReload, () => view.reload())
  ipcMain.handle(Channels.webOpenExternal, () => view.openExternalCurrent())
  // A reload of the app page leaves no Web tab to sit under.
  win.webContents.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) view.hide()
  })
  return view
}
