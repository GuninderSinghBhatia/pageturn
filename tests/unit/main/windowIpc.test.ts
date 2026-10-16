import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  screen: { getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
}))

import { Channels } from '@shared/ipc'
import { registerWindowIpc } from '../../../src/main/ipc/window'

const state = { maximized: false, fullscreen: false }
const win = {
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
  setFullScreen: vi.fn(),
  webContents: { send: vi.fn() },
  setAspectRatio: vi.fn(),
  setContentSize: vi.fn(),
  getContentSize: () => [1200, 800],
  getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  isMaximized: () => state.maximized,
  isFullScreen: () => state.fullscreen,
  on: vi.fn()
}

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  state.maximized = false
  state.fullscreen = false
  registerWindowIpc(win as never)
})

const call = (ch: string, ...a: unknown[]): unknown => handlers.get(ch)!({}, ...a)

describe('window chrome IPC', () => {
  it('minimise, maximise / restore and close come from the app buttons', () => {
    call(Channels.windowControl, 'minimize')
    expect(win.minimize).toHaveBeenCalled()
    call(Channels.windowControl, 'toggleMaximize')
    expect(win.maximize).toHaveBeenCalled()
    state.maximized = true
    call(Channels.windowControl, 'toggleMaximize')
    expect(win.unmaximize).toHaveBeenCalled()
    state.fullscreen = true
    call(Channels.windowControl, 'toggleMaximize')
    expect(win.setFullScreen).toHaveBeenCalledWith(false)
    call(Channels.windowControl, 'close')
    expect(win.close).toHaveBeenCalled()
    expect(() => call(Channels.windowControl, 'explode')).toThrow('Invalid payload')
  })

  it('reports maximized / fullscreen changes to the page', () => {
    expect(call(Channels.windowGetState)).toEqual({ maximized: false, fullscreen: false })
    const onMax = win.on.mock.calls.find(([ev]) => ev === 'maximize')![1] as () => void
    state.maximized = true
    onMax()
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.windowState, {
      maximized: true,
      fullscreen: false
    })
  })
})
