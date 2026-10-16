import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  screen: { getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
}))

import { Channels } from '@shared/ipc'
import { registerWindowIpc } from '../../../src/main/ipc/window'

const win = {
  setTitleBarOverlay: vi.fn(),
  setAspectRatio: vi.fn(),
  setContentSize: vi.fn(),
  getContentSize: () => [1200, 800],
  getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  isMaximized: () => false,
  isFullScreen: () => false,
  on: vi.fn()
}

beforeEach(() => {
  handlers.clear()
  win.setTitleBarOverlay.mockClear()
  registerWindowIpc(win as never)
})

const call = (ch: string, ...a: unknown[]): unknown => handlers.get(ch)!({}, ...a)

describe('window chrome IPC', () => {
  it('recolours the window-controls overlay to match the screen behind it', () => {
    call(Channels.windowSetTitleBar, { color: '#7f8d9c', symbolColor: '#ffffff' })
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#7f8d9c',
      symbolColor: '#ffffff',
      height: 36
    })
  })

  it('rejects anything but #rrggbb colours', () => {
    expect(() => call(Channels.windowSetTitleBar, { color: 'red', symbolColor: '#fff' })).toThrow(
      'Invalid payload'
    )
  })
})
