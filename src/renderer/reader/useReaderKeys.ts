import { useEffect } from 'react'
import { useNav } from '../app/nav'
import { useReaderStore } from '../stores/readerStore'

type Handlers = {
  onFind(): void
  onFocusPageBox(): void
  onEscape(): boolean // true if it closed or left something
  onToggleToolbar(): void
  onHighlight(): boolean // highlight the current text selection; false if there is none
  onBookmark(): void
  onNote(): boolean // note on the selection; false if none
  onAsk(): boolean // Ask AI on the selection; false if none
  onTogglePen(): void
  onEraser(): void
  onUndo(): boolean // false when there was nothing to undo
  onRedo(): boolean
}

const ZOOM_STEP = 1.25

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
}

/** Reader keyboard shortcuts (immersive reader spec §7). */
export function useReaderKeys({
  onFind,
  onFocusPageBox,
  onEscape,
  onToggleToolbar,
  onHighlight,
  onBookmark,
  onNote,
  onAsk,
  onTogglePen,
  onEraser,
  onUndo,
  onRedo
}: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useReaderStore.getState()
      if (!s.doc || useNav.getState().settingsOpen) return
      const ctrl = e.ctrlKey || e.metaKey
      const typing = isTyping(e.target)
      if (ctrl) {
        const k = e.key.toLowerCase()
        if (k === 'f') onFind()
        else if (k === 'g') onFocusPageBox()
        // Everything else is left to text fields (Ctrl+Z is text undo there, etc.).
        else if (typing) return
        else if (k === 'd') onBookmark()
        else if (k === 'z' && !e.shiftKey) onUndo()
        else if (k === 'y' || (k === 'z' && e.shiftKey)) onRedo()
        else if (k === '=' || k === '+') s.setZoom(s.zoom * ZOOM_STEP)
        else if (k === '-') s.setZoom(s.zoom / ZOOM_STEP)
        else if (k === '0') s.setZoom(1)
        else return
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        // Innermost first: cards and tools, then the toolbar, then fullscreen.
        if (!onEscape() && document.fullscreenElement) void document.exitFullscreen()
        return
      }
      if (e.key === 'F11') {
        e.preventDefault()
        toggleFullscreen()
        return
      }
      if (typing) return
      const canTurn = s.zoom <= 1 // zoomed in: keys scroll/pan instead
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          if (!canTurn) return
          s.requestTurn(e.key === ' ' && e.shiftKey ? -1 : 1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          if (!canTurn) return
          s.requestTurn(-1)
          break
        case 'Home':
          s.goTo(1)
          break
        case 'End':
          s.goTo(s.doc.numPages)
          break
        case 'h':
        case 'H':
          if (!onHighlight()) return
          break
        case 'p':
        case 'P':
          onTogglePen()
          break
        case 'e':
        case 'E':
          onEraser()
          break
        case 't':
        case 'T':
          onToggleToolbar()
          break
        case 'b':
        case 'B':
          onBookmark()
          break
        case 'n':
        case 'N':
          if (!onNote()) return
          break
        case 'a':
        case 'A':
          if (!onAsk()) return
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onFind,
    onFocusPageBox,
    onEscape,
    onToggleToolbar,
    onHighlight,
    onBookmark,
    onNote,
    onAsk,
    onTogglePen,
    onEraser,
    onUndo,
    onRedo
  ])
}
