import { ipcMain, screen, type BrowserWindow } from 'electron'
import { Channels, WindowAspectSchema } from '@shared/ipc'
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

  ipcMain.handle(Channels.windowFitAspect, (_e, a: unknown) => {
    aspect = parse(WindowAspectSchema, a)
    fit()
  })
  // Back from maximized / fullscreen: take the book's shape again.
  win.on('unmaximize', fit)
  win.on('leave-full-screen', fit)
  win.on('maximize', () => win.setAspectRatio(0))
  win.on('enter-full-screen', () => win.setAspectRatio(0))
}
