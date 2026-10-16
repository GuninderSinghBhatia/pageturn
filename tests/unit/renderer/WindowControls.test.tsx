// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { WindowState } from '@shared/ipc'
import { WindowControls } from '@renderer/app/WindowControls'
import { useNav } from '@renderer/app/nav'

let control: ReturnType<typeof vi.fn>
let push: (s: WindowState) => void

beforeEach(() => {
  control = vi.fn().mockResolvedValue(undefined)
  window.api = {
    window: {
      control,
      getState: vi.fn().mockResolvedValue({ maximized: false, fullscreen: false }),
      onState: (cb: (s: WindowState) => void) => {
        push = cb
        return () => {}
      },
      platform: 'win32'
    }
  } as unknown as typeof window.api
  useNav.setState({ view: 'library', settingsOpen: false })
})
afterEach(cleanup)

describe('WindowControls', () => {
  it('minimise / maximise / close drive the window; the icon follows the window state', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(control.mock.calls.map((c) => c[0])).toEqual(['minimize', 'toggleMaximize', 'close'])
    act(() => push({ maximized: true, fullscreen: false }))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    act(() => push({ maximized: false, fullscreen: true }))
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy()
  })

  it('corner buttons on the home page; while reading the toolbar carries them instead', () => {
    const corner = render(<WindowControls />)
    expect(corner.queryByTestId('window-controls')).toBeTruthy()
    act(() => useNav.setState({ view: { reader: 'a'.repeat(64) } }))
    expect(corner.queryByTestId('window-controls')).toBeNull()
    corner.unmount()
    const inToolbar = render(<WindowControls inline />)
    expect(inToolbar.getByRole('group', { name: 'Window' })).toBeTruthy()
    act(() => useNav.setState({ view: 'library' }))
    expect(inToolbar.queryByTestId('window-controls')).toBeNull()
  })

  it('macOS keeps its own traffic lights', () => {
    window.api.window.platform = 'darwin'
    const { container } = render(<WindowControls />)
    expect(container.innerHTML).toBe('')
  })
})
