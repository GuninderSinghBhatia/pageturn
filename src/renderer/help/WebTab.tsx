import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SearchEngine } from '@shared/ai'
import type { WebBounds, WebState } from '@shared/ipc'
import { useSettingsStore } from '../stores/settingsStore'
import { useHelpStore } from './helpStore'
import styles from './Help.module.css'

const ENGINES: [SearchEngine, string][] = [
  ['duckduckgo', 'DuckDuckGo'],
  ['google', 'Google'],
  ['bing', 'Bing']
]

const rectOf = (el: HTMLElement): WebBounds => {
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height))
  }
}

/**
 * The Web tab: a toolbar plus a placeholder whose rectangle main covers with a sandboxed
 * web view. The view is hidden whenever this tab is not on screen (panel closed, Explain
 * tab, Settings open), since a native view always draws above the page.
 */
export function WebTab({
  bookTitle,
  hidden
}: {
  bookTitle: string | null
  hidden: boolean
}): React.JSX.Element {
  const query = useHelpStore((s) => s.webQuery)
  const setQuery = useHelpStore((s) => s.setWebQuery)
  const engine = useSettingsStore((s) => s.settings.searchEngine)
  const setSettings = useSettingsStore((s) => s.set)
  const slotRef = useRef<HTMLDivElement>(null)
  const searched = useRef<string | null>(null)
  const [draft, setDraft] = useState(query)
  const [state, setState] = useState<WebState | null>(null)

  useEffect(() => window.api.web.onState(setState), [])

  const search = (q: string): void => {
    if (!slotRef.current || !q.trim()) return
    searched.current = q
    void window.api.web.show(q, rectOf(slotRef.current), bookTitle)
  }

  // Show (first time / new query) or reveal; hide when off screen.
  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el || hidden) {
      void window.api.web.hide()
      return
    }
    if (searched.current !== query) search(query)
    else void window.api.web.reveal(rectOf(el))
    const ro = new ResizeObserver(() => void window.api.web.setBounds(rectOf(el)))
    ro.observe(el)
    const onResize = (): void => void window.api.web.setBounds(rectOf(el))
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      void window.api.web.hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, query])

  return (
    <div className={styles.web}>
      <div className={styles.webBar}>
        <button
          className={styles.iconBtn}
          aria-label="Back"
          disabled={!state?.canGoBack}
          onClick={() => void window.api.web.back()}
        >
          ‹
        </button>
        <button
          className={styles.iconBtn}
          aria-label="Forward"
          disabled={!state?.canGoForward}
          onClick={() => void window.api.web.forward()}
        >
          ›
        </button>
        <button
          className={styles.iconBtn}
          aria-label="Reload"
          onClick={() => void window.api.web.reload()}
        >
          ↻
        </button>
        <form
          className={styles.webForm}
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(draft)
            search(draft)
          }}
        >
          <input
            className={styles.webQuery}
            aria-label="Search the web"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
        <select
          className={styles.langSelect}
          aria-label="Search engine"
          value={engine}
          onChange={async (e) => {
            await setSettings({ searchEngine: e.target.value as SearchEngine })
            search(draft)
          }}
        >
          {ENGINES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          className={styles.iconBtn}
          aria-label="Open in browser"
          title="Open in browser"
          onClick={() => void window.api.web.openExternal()}
        >
          ↗
        </button>
      </div>
      <div
        className={styles.webSlot}
        ref={slotRef}
        data-testid="web-slot"
        data-url={state?.url ?? ''}
      >
        {state?.error === 'offline' && (
          <div className={styles.card}>
            <h3>You seem to be offline</h3>
            <p>The search page could not load. Check your connection and try again.</p>
            <button className={styles.ghost} onClick={() => void window.api.web.reload()}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
