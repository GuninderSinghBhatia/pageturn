import type { ResolvedLayout, Spread } from '../layout'
import type { Rect } from './webgl/renderer'

type Size = { width: number; height: number }

/** Page rects (CSS px within the stage), centred on the spine; one shared rect in single mode. */
export function computeRects(
  spread: Spread,
  layout: ResolvedLayout,
  vp: Size,
  pageSize: (p: number) => Size
): { left: Rect | null; right: Rect | null } {
  const cx = vp.width / 2
  const cy = vp.height / 2
  const rect = (p: number, x: (w: number) => number): Rect => {
    const s = pageSize(p)
    return { x: x(s.width), y: cy - s.height / 2, width: s.width, height: s.height }
  }
  if (layout === 'single') {
    const r = rect(spread.right!, (w) => cx - w / 2)
    return { left: r, right: r }
  }
  return {
    left: spread.left === null ? null : rect(spread.left, (w) => cx - w),
    right: spread.right === null ? null : rect(spread.right, () => cx)
  }
}

type Rects = { left: Rect | null; right: Rect | null }
type Pan = { x: number; y: number }

/** Fit-size page rects zoomed about the viewport centre, then panned. */
export function viewRects(fit: Rects, vp: Size, zoom: number, pan: Pan): Rects {
  if (zoom === 1 && pan.x === 0 && pan.y === 0) return fit
  const cx = vp.width / 2
  const cy = vp.height / 2
  const t = (r: Rect | null): Rect | null =>
    r && {
      x: cx + (r.x - cx) * zoom + pan.x,
      y: cy + (r.y - cy) * zoom + pan.y,
      width: r.width * zoom,
      height: r.height * zoom
    }
  const left = t(fit.left)
  return { left, right: fit.right === fit.left ? left : t(fit.right) }
}

/** Limits panning so a zoomed-in book can't be dragged away from the window edges. */
export function clampPan(fit: Rects, vp: Size, zoom: number, pan: Pan): Pan {
  if (zoom <= 1) return { x: 0, y: 0 }
  const rs = [fit.left, fit.right].filter((r): r is Rect => r !== null)
  if (rs.length === 0) return { x: 0, y: 0 }
  const w = (Math.max(...rs.map((r) => r.x + r.width)) - Math.min(...rs.map((r) => r.x))) * zoom
  const h = Math.max(...rs.map((r) => r.height)) * zoom
  const mx = Math.max(0, (w - vp.width) / 2)
  const my = Math.max(0, (h - vp.height) / 2)
  const clamp = (v: number, m: number): number => (Math.abs(v) <= m ? v : Math.sign(v) * m)
  return { x: clamp(pan.x, mx), y: clamp(pan.y, my) }
}

/**
 * Pan that keeps the book point under `focus` (stage px) where it is when the zoom changes
 * from `from` to `to`, so zooming grows the page around the word under the pointer.
 */
export function focalPan(pan: Pan, focus: Pan, centre: Pan, from: number, to: number): Pan {
  const k = to / from
  return {
    x: focus.x - centre.x - (focus.x - centre.x - pan.x) * k,
    y: focus.y - centre.y - (focus.y - centre.y - pan.y) * k
  }
}
