import { useEffect, useState, type RefObject } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@shared/types'
import { useReaderStore } from '../../stores/readerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { HIGHLIGHT_HEX } from './draw'
import { hasTextSelection, highlightSelection } from './selection'
import styles from './Annotations.module.css'

type Anchor = { left: number; top: number; width: number }

type Props = {
  anchor: Anchor // viewport coordinates of the selection's first rect
  current: HighlightColor // last-used colour
  onHighlight(color: HighlightColor): void
  onCopy(): void
}

/** Floating colour picker shown above a text selection. */
export function SelectionToolbar({
  anchor,
  current,
  onHighlight,
  onCopy
}: Props): React.JSX.Element {
  return (
    <div
      className={styles.selectionToolbar}
      role="toolbar"
      aria-label="Highlight selection"
      data-no-turn
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top }}
      onPointerDown={(e) => e.preventDefault()} // keep the selection
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className={styles.swatch}
          style={{ background: HIGHLIGHT_HEX[c] }}
          aria-label={c}
          aria-pressed={c === current}
          onClick={() => onHighlight(c)}
        />
      ))}
      <button className={styles.toolbarBtn} onClick={onCopy}>
        Copy
      </button>
    </div>
  )
}

/** Watches the selection inside `root` and shows the toolbar above it. */
export function SelectionToolbarHost({
  rootRef
}: {
  rootRef: RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  // Tagged with the page it was shown on: a turn moves the text away, so it's stale then.
  const [anchor, setAnchor] = useState<(Anchor & { page: number }) | null>(null)
  const color = useSettingsStore((s) => s.settings.highlightColor)
  const page = useReaderStore((s) => s.page)

  useEffect(() => {
    const root = rootRef.current
    const update = (): void => {
      const sel = window.getSelection()
      if (!hasTextSelection(root) || !sel) return setAnchor(null)
      const r = sel.getRangeAt(0).getClientRects()[0] ?? sel.getRangeAt(0).getBoundingClientRect()
      setAnchor({ left: r.left, top: r.top, width: r.width, page: useReaderStore.getState().page })
    }
    const hideIfCollapsed = (): void => {
      if (window.getSelection()?.isCollapsed ?? true) setAnchor(null)
    }
    document.addEventListener('pointerup', update)
    document.addEventListener('keyup', update)
    document.addEventListener('selectionchange', hideIfCollapsed)
    root?.addEventListener('scroll', hideIfCollapsed, true)
    return () => {
      document.removeEventListener('pointerup', update)
      document.removeEventListener('keyup', update)
      document.removeEventListener('selectionchange', hideIfCollapsed)
      root?.removeEventListener('scroll', hideIfCollapsed, true)
    }
  }, [rootRef])

  if (!anchor || anchor.page !== page) return null
  return (
    <SelectionToolbar
      anchor={anchor}
      current={color}
      onHighlight={(c) => {
        if (highlightSelection(rootRef.current, c))
          void useSettingsStore.getState().set({ highlightColor: c })
        setAnchor(null)
      }}
      onCopy={() => {
        void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '')
        setAnchor(null)
      }}
    />
  )
}
