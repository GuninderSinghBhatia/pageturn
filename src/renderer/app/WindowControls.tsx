import { useEffect, useState } from 'react'
import type { WindowControl, WindowState } from '@shared/ipc'
import { useNav } from './nav'
import styles from './WindowControls.module.css'

const Glyph = ({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }): React.JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    {kind === 'min' && <path d="M0 5.5h10" stroke="currentColor" />}
    {kind === 'max' && (
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
    )}
    {kind === 'restore' && (
      <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor" />
    )}
    {kind === 'close' && <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />}
  </svg>
)

/**
 * Minimise / maximise / close, drawn by the app (the OS title bar is hidden). On the home page
 * and in Settings they sit flush in the top-right corner. While reading, the reader toolbar
 * carries them (`inline`) as a small pill beside the tools: they slide in and out with it and
 * never cover the page.
 */
export function WindowControls({ inline = false }: { inline?: boolean }): React.JSX.Element | null {
  const reading = useNav((s) => s.view !== 'library' && !s.settingsOpen)
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false })

  useEffect(() => {
    let live = true
    void window.api.window.getState().then((s) => live && setState(s))
    const off = window.api.window.onState(setState)
    return () => {
      live = false
      off()
    }
  }, [])

  if (window.api.window.platform === 'darwin' || reading !== inline) return null

  const act = (a: WindowControl) => () => void window.api.window.control(a)
  const restore = state.maximized || state.fullscreen

  return (
    <div
      className={`${styles.controls} ${inline ? styles.inline : styles.flush}`}
      role="group"
      aria-label="Window"
      data-testid="window-controls"
    >
      <button className={styles.btn} aria-label="Minimize" onClick={act('minimize')}>
        <Glyph kind="min" />
      </button>
      <button
        className={styles.btn}
        aria-label={state.fullscreen ? 'Exit full screen' : restore ? 'Restore' : 'Maximize'}
        onClick={act('toggleMaximize')}
      >
        <Glyph kind={restore ? 'restore' : 'max'} />
      </button>
      <button className={`${styles.btn} ${styles.close}`} aria-label="Close" onClick={act('close')}>
        <Glyph kind="close" />
      </button>
    </div>
  )
}
