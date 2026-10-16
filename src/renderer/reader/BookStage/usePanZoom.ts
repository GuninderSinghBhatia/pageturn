import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { Rect } from './webgl/renderer'
import { clampPan, focalPan } from './pageRects'

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

  // Where the pointer is over the book (stage px), so zooming grows the page around that word.
  const pointer = useRef<Pan | null>(null)
  const prevZoom = useRef(opts.zoom)

  // On a zoom change keep the point under the pointer still (the centre if the pointer is
  // elsewhere, e.g. on the toolbar); then clamp. Resets to centre at 100%.
  useEffect(() => {
    const from = prevZoom.current
    prevZoom.current = opts.zoom
    const centre = { x: opts.viewport.width / 2, y: opts.viewport.height / 2 }
    const next =
      from !== opts.zoom
        ? focalPan(panRef.current, pointer.current ?? centre, centre, from, opts.zoom)
        : panRef.current
    applyRef.current(next)
  }, [opts.zoom, opts.viewport])

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
    const track = (e: PointerEvent): void => {
      const b = el.getBoundingClientRect()
      pointer.current = { x: e.clientX - b.left, y: e.clientY - b.top }
    }
    const leave = (): void => {
      pointer.current = null
    }
    const move = (e: PointerEvent): void => {
      track(e)
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
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerleave', leave)
    }
  }, [opts.stageRef])

  return { pan, panRef }
}
