import { useEffect, useRef, type RefObject } from 'react'
import type { InkStroke } from '@shared/types'
import { pageAt } from '../annotations/pageAt'

export type InkMode = {
  active: boolean
  tool: 'pen' | 'highlighter' | 'eraser'
  color: string
  width: number // fraction of page width
}

/** Names for INK_WIDTHS, in order. */
export const WIDTH_LABELS = ['Thin', 'Medium', 'Thick'] as const

type PointerLike = { pointerType: string; buttons: number; button: number }

const PEN_ERASER_BUTTONS = 32
const PEN_ERASER_BUTTON = 5

/** What a pointer press does in the current pen mode. */
export function inkAction(
  e: PointerLike,
  mode: InkMode,
  drawWithMouse: boolean
): 'draw' | 'erase' | 'pass' {
  if (!mode.active || e.pointerType === 'touch') return 'pass'
  if (
    e.pointerType === 'pen' &&
    (e.buttons & PEN_ERASER_BUTTONS || e.button === PEN_ERASER_BUTTON)
  ) {
    return 'erase'
  }
  if (e.pointerType === 'mouse') {
    if (e.button !== 0) return 'pass'
    if (mode.tool === 'eraser') return 'erase' // picked explicitly: works with the mouse
    if (!drawWithMouse) return 'pass'
  }
  return mode.tool === 'eraser' ? 'erase' : 'draw'
}

type Options = {
  viewportRef: RefObject<HTMLElement | null>
  /** Read live on each press, so a tool picked a moment ago already applies. */
  getMode(): InkMode
  getDrawWithMouse(): boolean
  onLive(page: number, stroke: InkStroke | null): void
  onCommit(page: number, stroke: InkStroke): void
  /** Eraser at p; `aspect` = page height / width (for distances in page widths). */
  onErase(page: number, p: { x: number; y: number }, aspect: number): void
  onEraseEnd(page: number): void
}

const clamp = (v: number): number => Math.min(1.05, Math.max(-0.05, v))

/**
 * Pen input on the reader viewport. Listens in the capture phase so a drawing pointer never
 * reaches the stage (no page turn, no text selection); other pointers pass through untouched.
 */
export function useInkInput(opts: Options): void {
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })

  useEffect(() => {
    const root = opts.viewportRef.current
    if (!root) return
    let active: {
      id: number
      page: number
      box: DOMRect
      action: 'draw' | 'erase'
      stroke: InkStroke
    } | null = null

    const local = (box: DOMRect, e: PointerEvent): { x: number; y: number } => ({
      x: clamp((e.clientX - box.left) / box.width),
      y: clamp((e.clientY - box.top) / box.height)
    })
    const pressure = (e: PointerEvent): number =>
      e.pointerType === 'pen' ? Math.min(1, Math.max(0.05, e.pressure || 0.5)) : 0.5

    const down = (e: PointerEvent): void => {
      const o = latest.current
      const mode = o.getMode()
      const action = inkAction(e, mode, o.getDrawWithMouse())
      if (action === 'pass') return
      const hit = pageAt(root, e.clientX, e.clientY)
      if (!hit) return
      e.stopPropagation()
      e.preventDefault()
      root.setPointerCapture(e.pointerId)
      const box = root.querySelector(`[data-page-overlay="${hit.page}"]`)!.getBoundingClientRect()
      const p = local(box, e)
      const tool = mode.tool === 'highlighter' ? 'highlighter' : 'pen'
      active = {
        id: e.pointerId,
        page: hit.page,
        box,
        action,
        stroke: {
          id: 'live',
          bookId: '',
          page: hit.page,
          points: [[p.x, p.y, pressure(e)]],
          color: mode.color,
          width: mode.width,
          tool,
          createdAt: Date.now()
        }
      }
      if (action === 'erase') o.onErase(hit.page, p, box.height / box.width)
      else o.onLive(hit.page, active.stroke)
    }

    const move = (e: PointerEvent): void => {
      if (!active || e.pointerId !== active.id) return
      e.stopPropagation()
      // Chromium sends synthetic button-less moves (e.g. on repaint); only follow a held button.
      const events = (e.getCoalescedEvents?.() ?? [e]).filter((ev) => ev.buttons !== 0)
      if (active.action === 'erase') {
        const aspect = active.box.height / active.box.width
        for (const ev of events) latest.current.onErase(active.page, local(active.box, ev), aspect)
        return
      }
      const points = [...active.stroke.points]
      for (const ev of events) {
        const p = local(active.box, ev)
        points.push([p.x, p.y, pressure(ev)])
      }
      active.stroke = { ...active.stroke, points }
      latest.current.onLive(active.page, active.stroke)
    }

    const up = (e: PointerEvent): void => {
      if (!active || e.pointerId !== active.id) return
      e.stopPropagation()
      const done = active
      active = null
      if (done.action === 'erase') latest.current.onEraseEnd(done.page)
      if (done.action === 'draw') {
        latest.current.onLive(done.page, null)
        if (done.stroke.points.length >= 2) latest.current.onCommit(done.page, done.stroke)
      }
    }

    root.addEventListener('pointerdown', down, true)
    root.addEventListener('pointermove', move, true)
    root.addEventListener('pointerup', up, true)
    root.addEventListener('pointercancel', up, true)
    return () => {
      root.removeEventListener('pointerdown', down, true)
      root.removeEventListener('pointermove', move, true)
      root.removeEventListener('pointerup', up, true)
      root.removeEventListener('pointercancel', up, true)
    }
  }, [opts.viewportRef])
}
