import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { Rect } from './webgl/renderer'
import { clampPan } from './pageRects'

type Rects = { left: Rect | null; right: Rect | null }
type Pan = { x: number; y: number }
type Size = { width: number; height: number }

/**
 * Panning a zoomed-in book: drag the paper (not text or controls) or scroll. Returns the pan
 * for rendering plus a ref for the draw loop. Pan resets at or below 100%.
 */
export function usePanZoom(opts: {
  stageRef: RefObject<HTMLElement | null>
  zoom: number
  viewport: Size
  fitRects: () => Rects
  onChange(): void
}): { pan: Pan; panRef: MutableRefObject<Pan> } {
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const panRef = useRef<Pan>(pan)
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })

  const apply = (next: Pan): void => {
    const o = latest.current
    const c = clampPan(o.fitRects(), o.viewport, o.zoom, next)
    if (c.x === panRef.current.x && c.y === panRef.current.y) return
    panRef.current = c
    setPan(c)
    o.onChange()
  }
  const applyRef = useRef(apply)
  useEffect(() => {
    applyRef.current = apply
  })

  // Re-clamp when the zoom or window changes (resets to centre at or below 100%).
  useEffect(() => applyRef.current(panRef.current), [opts.zoom, opts.viewport])

  useEffect(() => {
    const el = opts.stageRef.current
    if (!el) return
    let drag: { id: number; x: number; y: number; start: Pan } | null = null
    const down = (e: PointerEvent): void => {
      if (latest.current.zoom <= 1 || e.button !== 0) return
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('.textLayer, [data-no-turn]')) return // text selection, controls
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: panRef.current }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id || (e.buttons & 1) === 0) return
      applyRef.current({
        x: drag.start.x + e.clientX - drag.x,
        y: drag.start.y + e.clientY - drag.y
      })
    }
    const up = (e: PointerEvent): void => {
      if (drag && e.pointerId === drag.id) drag = null
    }
    const wheel = (e: WheelEvent): void => {
      if (latest.current.zoom <= 1 || e.ctrlKey) return
      applyRef.current({ x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY })
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [opts.stageRef])

  return { pan, panRef }
}
