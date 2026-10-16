import { useEffect, type RefObject } from 'react'
import type { Rect } from './webgl/renderer'
import type { Corner, Vec2 } from './webgl/curlMath'
import type { TurnController } from './turnController'

const EDGE_ZONE = 0.15 // fraction of page width/height near corners/edges that starts a drag
const CLICK_SLOP_PX = 5
const WHEEL_DEBOUNCE_MS = 250

type Options = {
  stageRef: RefObject<HTMLElement | null>
  controller: TurnController
  rects: () => { left: Rect | null; right: Rect | null }
  onChange(): void // request a redraw
}

type Hit = { side: 'left' | 'right'; rect: Rect; local: Vec2; edge: boolean; outerThird: boolean }

function hitTest(
  rects: { left: Rect | null; right: Rect | null },
  x: number,
  y: number
): Hit | null {
  const single = rects.left !== null && rects.left === rects.right
  for (const candidate of ['right', 'left'] as const) {
    const rect = rects[candidate]
    if (!rect || x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) {
      continue
    }
    const u = (x - rect.x) / rect.width
    const v = (y - rect.y) / rect.height
    // Single-page layout: the left half turns back, the right half forward.
    const side = single ? (u < 0.5 ? 'left' : 'right') : candidate
    const fromOuter = side === 'right' ? 1 - u : u
    const nearCornerRow = v < EDGE_ZONE || v > 1 - EDGE_ZONE
    return {
      side,
      rect,
      local: { x: u, y: v * (rect.height / rect.width) },
      edge: fromOuter < EDGE_ZONE || (nearCornerRow && fromOuter < 2 * EDGE_ZONE),
      outerThird: fromOuter < 1 / 3
    }
  }
  return null
}

const toLocal = (rect: Rect, x: number, y: number): Vec2 => ({
  x: (x - rect.x) / rect.width,
  y: (y - rect.y) / rect.width // page-local y is in page-width units
})

/** Drag from corners/edges to curl, click the outer third to turn, wheel to turn. */
export function useTurnGesture({ stageRef, controller, rects, onChange }: Options): void {
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let drag: {
      rect: Rect
      startX: number
      startY: number
      lastX: number
      lastT: number
      vx: number
      moved: boolean
      dir: 1 | -1
    } | null = null
    let clickDir: 1 | -1 | null = null
    let clickOnText = false
    let lastWheel = 0

    const pos = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
      const b = el.getBoundingClientRect()
      return { x: e.clientX - b.left, y: e.clientY - b.top }
    }

    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      clickDir = null
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('[data-no-turn]')) return // annotation controls handle their own clicks
      // On text, a press may start a selection: never curl from it, only click-turn (see up).
      clickOnText = !!target?.closest('.textLayer')
      const { x, y } = pos(e)
      const hit = hitTest(rects(), x, y)
      if (!hit) return
      const dir = hit.side === 'right' ? 1 : -1
      if (hit.edge && !clickOnText) {
        const corner =
          `${hit.local.y < hit.rect.height / hit.rect.width / 2 ? 't' : 'b'}${hit.side === 'right' ? 'r' : 'l'}` as Corner
        controller.pointerDown(corner, hit.local)
        if (controller.current.phase !== 'dragging') return
        drag = {
          rect: hit.rect,
          startX: x,
          startY: y,
          lastX: x,
          lastT: e.timeStamp,
          vx: 0,
          moved: false,
          dir
        }
        el.setPointerCapture(e.pointerId)
        onChange()
      } else if (hit.outerThird) clickDir = dir
    }

    const move = (e: PointerEvent): void => {
      // Chromium sends synthetic button-less moves (e.g. on repaint); only follow a held button.
      if (!drag || (e.buttons & 1) === 0) return
      const { x, y } = pos(e)
      const dt = Math.max(1, e.timeStamp - drag.lastT) / 1000
      drag.vx = 0.7 * ((x - drag.lastX) / drag.rect.width / dt) + 0.3 * drag.vx
      drag.lastX = x
      drag.lastT = e.timeStamp
      if (Math.hypot(x - drag.startX, y - drag.startY) > CLICK_SLOP_PX) drag.moved = true
      controller.pointerMove(toLocal(drag.rect, x, y), drag.vx)
      onChange()
    }

    const up = (): void => {
      if (drag) {
        const d = drag
        drag = null
        if (d.moved) controller.pointerUp()
        else {
          controller.reset() // a click on the corner: animate a full turn instead
          controller.turn(d.dir)
        }
        onChange()
      } else if (clickDir) {
        const selecting = clickOnText && !(window.getSelection()?.isCollapsed ?? true)
        if (!selecting) {
          controller.turn(clickDir)
          onChange()
        }
        clickDir = null
      }
    }

    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.deltaY === 0) return // Ctrl+wheel zooms (handled by the reader)
      const now = e.timeStamp
      const fresh = now - lastWheel > WHEEL_DEBOUNCE_MS
      lastWheel = now
      if (!fresh) return
      controller.turn(e.deltaY > 0 ? 1 : -1)
      onChange()
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
  }, [stageRef, controller, rects, onChange])
}
