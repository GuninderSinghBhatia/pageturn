// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { UpdateNotices } from '@renderer/app/UpdateNotices'
import { useToastStore } from '@renderer/stores/toastStore'

let available: (e: { version: string }) => void
let downloaded: (e: { version: string }) => void
const installUpdate = vi.fn(async () => {})

beforeEach(() => {
  installUpdate.mockClear()
  useToastStore.setState({ toasts: [] })
  window.api = {
    app: {
      onUpdateAvailable: (cb: typeof available) => {
        available = cb
        return () => {}
      },
      onUpdateDownloaded: (cb: typeof downloaded) => {
        downloaded = cb
        return () => {}
      },
      installUpdate
    }
  } as unknown as typeof window.api
})
afterEach(cleanup)

describe('UpdateNotices', () => {
  it('says a new version is on its way, then offers to restart into it', () => {
    render(<UpdateNotices />)
    act(() => available({ version: '1.0.1' }))
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      'PageTurn 1.0.1 is available. Downloading it in the background…'
    ])

    act(() => downloaded({ version: '1.0.1' }))
    const ready = useToastStore.getState().toasts.at(-1)!
    expect(ready.text).toBe('PageTurn 1.0.1 is ready to install.')
    expect(ready.action?.label).toBe('Restart now')
    // The download notice is replaced, not stacked.
    expect(useToastStore.getState().toasts).toHaveLength(1)
    ready.action!.run()
    expect(installUpdate).toHaveBeenCalled()
  })

  it('announces each version once', () => {
    render(<UpdateNotices />)
    act(() => available({ version: '1.0.1' }))
    act(() => available({ version: '1.0.1' }))
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})
