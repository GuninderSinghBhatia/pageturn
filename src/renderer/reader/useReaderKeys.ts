import { useEffect } from 'react'
import { useReaderStore } from '../stores/readerStore'

type Handlers = {
  onFind(): void
  onFocusPageBox(): void
  onEscape(): void
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
export function useReaderKeys({ onFind, onFocusPageBox, onEscape }: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useReaderStore.getState()
      if (!s.doc) return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl) {
        const k = e.key.toLowerCase()
        if (k === 'f') onFind()
        else if (k === 'g') onFocusPageBox()
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
      if (isTyping(e.target)) return
      const canTurn = s.zoom <= 1 // zoomed in: keys scroll/pan instead
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          if (!canTurn) return
          s.next()
          break
        case 'ArrowLeft':
        case 'PageUp':
          if (!canTurn) return
          s.prev()
          break
        case 'Home':
          s.goTo(1)
          break
        case 'End':
          s.goTo(s.doc.numPages)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFind, onFocusPageBox, onEscape])
}
