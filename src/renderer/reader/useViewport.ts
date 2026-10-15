import { useEffect, useState, type RefObject } from 'react'

/** Tracks an element's content-box size. */
export function useViewportSize(ref: RefObject<HTMLElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** Drag-to-pan a scrollable element (used when zoomed past fit). */
export function usePan(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let start: { x: number; y: number; left: number; top: number } | null = null
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!start) return
      el.scrollLeft = start.left - (e.clientX - start.x)
      el.scrollTop = start.top - (e.clientY - start.y)
    }
    const up = (): void => {
      start = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [ref, enabled])
}
