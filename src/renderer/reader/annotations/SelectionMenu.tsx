import { useEffect, type RefObject } from 'react'
import { hasTextSelection } from './selection'
import { openHelp } from '../../help/openHelp'
import { LookupCard } from './LookupCard'
import { copySelection, highlight, lookUp, makeNote } from './selectionActions'
import { useOverlayUi } from './uiStore'
import styles from './Annotations.module.css'

/** Whether a viewport point lies on the current selection. */
function onSelection(x: number, y: number): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const pad = 2
  return [...sel.getRangeAt(0).getClientRects()].some(
    (r) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
  )
}

/** Right-click on selected text: note, AI, look up, highlight, copy (replaces the native menu). */
export function SelectionMenu({
  rootRef
}: {
  rootRef: RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const menu = useOverlayUi((s) => s.selectionMenu)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Capture phase: wins over the page menu ("Add note here") listening on the same root.
    const onContext = (e: MouseEvent): void => {
      if (!hasTextSelection(root) || !onSelection(e.clientX, e.clientY)) return
      e.preventDefault()
      e.stopPropagation()
      useOverlayUi.getState().showSelectionMenu({ clientX: e.clientX, clientY: e.clientY })
    }
    root.addEventListener('contextmenu', onContext, true)
    return () => root.removeEventListener('contextmenu', onContext, true)
  }, [rootRef])

  useEffect(() => {
    if (!menu) return
    const close = (e: Event): void => {
      if (!(e.target instanceof Element && e.target.closest('[role="menu"]'))) {
        useOverlayUi.getState().showSelectionMenu(null)
      }
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [menu])

  if (!menu) return null
  const close = (): void => useOverlayUi.getState().showSelectionMenu(null)
  return (
    <div
      className={`${styles.menu} ${styles.selectionMenu}`}
      role="menu"
      aria-label="Selection"
      data-no-turn
      style={{
        left: Math.min(menu.clientX, window.innerWidth - 200),
        top: Math.min(menu.clientY, window.innerHeight - 220)
      }}
      onPointerDown={(e) => e.preventDefault()} // keep the selection
    >
      <button
        role="menuitem"
        onClick={() => {
          close()
          makeNote(rootRef.current)
        }}
      >
        <span aria-hidden="true">📝</span> Make a note
      </button>
      <button
        role="menuitem"
        onClick={() => {
          close()
          openHelp(rootRef.current)
        }}
      >
        <span aria-hidden="true">✨</span> Ask AI
      </button>
      <button
        role="menuitem"
        onClick={() => {
          close()
          lookUp(rootRef.current)
        }}
      >
        <span aria-hidden="true">🔎</span> Look up
      </button>
      <hr className={styles.menuSep} />
      <button
        role="menuitem"
        onClick={() => {
          close()
          highlight(rootRef.current)
        }}
      >
        <span aria-hidden="true">🖍</span> Highlight
      </button>
      <button
        role="menuitem"
        onClick={() => {
          close()
          copySelection()
        }}
      >
        <span aria-hidden="true">📋</span> Copy
      </button>
    </div>
  )
}

/** Ask AI (placeholder) / Look up card, anchored under the selection and kept on screen. */
export function PhraseCard(): React.JSX.Element | null {
  const card = useOverlayUi((s) => s.card)
  useEffect(() => {
    if (!card) return
    const close = (e: PointerEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('[data-phrase-card]'))) {
        useOverlayUi.getState().showCard(null)
      }
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [card])
  if (!card) return null
  if (card.kind === 'lookup') return <LookupCard key={card.text} card={card} />
  const title = card.text.length > 60 ? `${card.text.slice(0, 57)}…` : card.text
  return (
    <div
      className={styles.phraseCard}
      role="dialog"
      aria-label="Ask AI"
      data-phrase-card
      data-no-turn
      style={{
        left: Math.max(16, Math.min(card.x, window.innerWidth - 296)),
        top: Math.min(card.y + 8, window.innerHeight - 180)
      }}
    >
      <div className={styles.phraseHead}>
        <strong className={styles.phraseTitle}>{title}</strong>
        <span className={styles.phraseLabel}>AI</span>
      </div>
      <p className={styles.phraseBody}>Coming soon — AI explanations will appear here.</p>
    </div>
  )
}
