import { useEffect, useRef, useState } from 'react'
import { useNav } from '../app/nav'
import { useSettingsStore } from '../stores/settingsStore'
import { ExplainTab } from './ExplainTab'
import { connectHelpEvents, useHelpStore } from './helpStore'
import { WebTab } from './WebTab'
import styles from './Help.module.css'

const MIN_W = 320
const MAX_FRACTION = 0.6

const clampWidth = (w: number): number =>
  Math.round(Math.max(MIN_W, Math.min(w, window.innerWidth * MAX_FRACTION)))

/** Right-side Help panel: Explain (AI) and Web tabs, resizable, width remembered. */
export function HelpPanel({
  bookTitle,
  onSaveNote,
  canSaveNote
}: {
  bookTitle: string | null
  onSaveNote?: () => void
  canSaveNote?: boolean
}): React.JSX.Element | null {
  const open = useHelpStore((s) => s.open)
  const tab = useHelpStore((s) => s.tab)
  const setTab = useHelpStore((s) => s.setTab)
  const close = useHelpStore((s) => s.close)
  const selection = useHelpStore((s) => s.selection)
  const settingsOpen = useNav((s) => s.settingsOpen)
  const saved = useSettingsStore((s) => s.settings.helpPanelWidth)
  const [width, setWidth] = useState<number | null>(null)
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => connectHelpEvents(), [])
  if (!open) return null

  const w = clampWidth(width ?? saved)
  const quote = selection ? selection.text : ''

  return (
    <aside className={styles.panel} style={{ width: w }} aria-label="Help" data-no-turn>
      <div
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize help panel"
        onPointerDown={(e) => {
          drag.current = { startX: e.clientX, startW: w }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setWidth(clampWidth(drag.current.startW + drag.current.startX - e.clientX))
        }}
        onPointerUp={() => {
          if (!drag.current) return
          drag.current = null
          void useSettingsStore.getState().set({ helpPanelWidth: w })
        }}
      />
      <header className={styles.head}>
        <div className={styles.tabs} role="tablist" aria-label="Help">
          {(['explain', 'web'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'explain' ? 'Explain' : 'Web'}
            </button>
          ))}
        </div>
        <button className={styles.iconBtn} aria-label="Close help" onClick={close}>
          ×
        </button>
      </header>
      {quote && (
        <blockquote className={styles.quote} title={quote}>
          {quote.length > 220 ? `${quote.slice(0, 217)}…` : quote}
        </blockquote>
      )}
      <div className={styles.body}>
        {tab === 'explain' ? (
          <ExplainTab onSaveNote={onSaveNote} canSaveNote={canSaveNote} />
        ) : (
          <WebTab bookTitle={bookTitle} hidden={settingsOpen} />
        )}
      </div>
    </aside>
  )
}
