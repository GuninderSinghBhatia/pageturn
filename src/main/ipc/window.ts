import { ipcMain, screen, type BrowserWindow } from 'electron'
import { Channels, WindowAspectSchema, WindowControlSchema, type WindowState } from '@shared/ipc'
import { parse } from './validate'

const FRAME_ALLOWANCE = 40 // px of the work area kept free for the window frame

/**
 * While a book is open in a normal (not maximized / fullscreen) window, the window keeps the
 * book's shape so there is no empty space around the pages. Aspect 0 releases the lock.
 */
export function registerWindowIpc(win: BrowserWindow): void {
  let aspect = 0

  const fit = (): void => {
    if (aspect === 0 || win.isMaximized() || win.isFullScreen()) {
      win.setAspectRatio(0)
      return
    }
    const [, contentH] = win.getContentSize()
    const area = screen.getDisplayMatching(win.getBounds()).workAreaSize
    let h = Math.min(contentH, area.height - FRAME_ALLOWANCE)
    let w = Math.round(h * aspect)
    if (w > area.width - FRAME_ALLOWANCE) {
      w = area.width - FRAME_ALLOWANCE
      h = Math.round(w / aspect)
    }
    win.setAspectRatio(aspect)
    win.setContentSize(w, h)
  }

  const state = (): WindowState => ({
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen()
  })
  const sendState = (): void => win.webContents.send(Channels.windowState, state())

  ipcMain.handle(Channels.windowGetState, state)
  ipcMain.handle(Channels.windowControl, (_e, a: unknown) => {
    const action = parse(WindowControlSchema, a)
    if (action === 'minimize') win.minimize()
    else if (action === 'close') win.close()
    else if (win.isFullScreen()) win.setFullScreen(false)
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(Channels.windowFitAspect, (_e, a: unknown) => {
    aspect = parse(WindowAspectSchema, a)
    fit()
  })
  // Back from maximized / fullscreen: take the book's shape again.
  const restored = (): void => {
    fit()
    sendState()
  }
  const enlarged = (): void => {
    win.setAspectRatio(0)
    sendState()
  }
  win.on('unmaximize', restored)
  win.on('leave-full-screen', restored)
  win.on('maximize', enlarged)
  win.on('enter-full-screen', enlarged)
}
