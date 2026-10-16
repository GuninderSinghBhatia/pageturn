import { useEffect } from 'react'
import { useNav } from '../app/nav'
import { useReaderStore } from '../stores/readerStore'

type Handlers = {
  onFind(): void
  onFocusPageBox(): void
  onEscape(): void
  onHighlight(): boolean // highlight the current text selection; false if there is none
  onBookmark(): void
}

const ZOOM_STEP = 1.25

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
}

/** Reader keyboard shortcuts (spec §4.8 subset). */
export function useReaderKeys({
  onFind,
  onFocusPageBox,
  onEscape,
  onHighlight,
  onBookmark
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
        else if (k === '=' || k === '+') s.setZoom(s.zoom * ZOOM_STEP)
        else if (k === '-') s.setZoom(s.zoom / ZOOM_STEP)
        else if (k === '0') s.setZoom(1)
        else return
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen()
        onEscape()
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
          s.requestTurn(1)
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
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFind, onFocusPageBox, onEscape, onHighlight, onBookmark])
}
