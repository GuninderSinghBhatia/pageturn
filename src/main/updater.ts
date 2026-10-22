import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import { Channels } from '@shared/ipc'
import { logsFolder } from './logging'

/**
 * Auto-update from GitHub Releases (packaged builds only). Downloads in the background and
 * tells the page, which offers "Restart to update".
 */
export function initUpdater(win: BrowserWindow): void {
  const send = (channel: string, payload?: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.on('update-available', (info) =>
    send(Channels.updateAvailable, { version: info.version })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send(Channels.updateDownloaded, { version: info.version })
  )
  autoUpdater.on('error', (err) => log.warn('Update check failed', err))

  ipcMain.handle(Channels.appVersion, () => app.getVersion())
  ipcMain.handle(Channels.appCheckForUpdates, async () => {
    if (!app.isPackaged) return { status: 'dev' as const }
    try {
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo.version
      return latest && latest !== app.getVersion()
        ? { status: 'available' as const, version: latest }
        : { status: 'current' as const }
    } catch {
      return { status: 'error' as const }
    }
  })
  ipcMain.handle(Channels.appInstallUpdate, () => autoUpdater.quitAndInstall())
  ipcMain.handle(Channels.appOpenLogs, async () => {
    await shell.openPath(logsFolder())
  })

  if (app.isPackaged) void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
}
