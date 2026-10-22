import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { join } from 'node:path'
import { z } from 'zod'
import { Channels } from '@shared/ipc'
import { parse } from './ipc/validate'

/** Logs go to userData/logs/main.log (rotated at 5 MB). Nothing is sent anywhere. */
export function initLogging(): void {
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.console.level = process.env.NODE_ENV === 'test' ? false : 'warn'
  process.on('uncaughtException', (err) => log.error('Uncaught exception', err))
  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', reason))
}

export const logsFolder = (): string => join(app.getPath('userData'), 'logs')

/**
 * App-level lifecycle: renderer error reports, the quit warning while changes are unsaved,
 * and a restart offer when the page crashes.
 */
export function registerAppIpc(win: BrowserWindow): void {
  let unsaved = 0
  ipcMain.handle(Channels.appSetUnsaved, (_e, n: unknown) => {
    unsaved = parse(z.number().int().min(0).max(100_000), n)
  })
  ipcMain.handle(Channels.appReportError, (_e, message: unknown, stack: unknown) => {
    log.error(
      'Renderer error',
      parse(z.string().max(5000), message),
      stack ? String(stack).slice(0, 10_000) : ''
    )
  })

  win.on('close', (e) => {
    if (unsaved === 0) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: "Some changes couldn't be saved. Quit anyway?",
      detail: 'Your latest highlights or notes may be lost.'
    })
    if (choice === 1) e.preventDefault()
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('Renderer process gone', details)
    if (details.reason === 'clean-exit') return
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      buttons: ['Restart', 'Quit'],
      defaultId: 0,
      message: 'PageTurn hit a problem. Restart?'
    })
    if (choice === 0) app.relaunch()
    app.exit(0)
  })
}
