import { getStroke } from 'perfect-freehand'
import type { InkStroke } from '@shared/types'

/**
 * Filled outline (pixels) of a stroke whose points are page-normalized and whose width is a
 * fraction of page width. Mouse/touch strokes simulate pressure from speed.
 */
export function strokeOutline(
  points: InkStroke['points'],
  width: number,
  sizePx: { w: number; h: number },
  simulatePressure: boolean
): [number, number][] {
  const px = points.map(([x, y, p]) => [x * sizePx.w, y * sizePx.h, p])
  return getStroke(px, {
    size: width * sizePx.w,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure
  }) as [number, number][]
}

/** Distance from p to segment ab (all in the same units). */
function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Whether an eraser at p (page-normalized) of `radius` (page widths) touches the stroke.
 * `aspect` = page height / width, so y distances are measured in page widths too.
 */
export function strokeHit(
  stroke: InkStroke,
  p: { x: number; y: number },
  radius: number,
  aspect: number
): boolean {
  const toW = ([x, y]: [number, number, number]): { x: number; y: number } => ({ x, y: y * aspect })
  const q = { x: p.x, y: p.y * aspect }
  const reach = radius + stroke.width / 2
  const pts = stroke.points.map(toW)
  if (pts.length === 1) return Math.hypot(q.x - pts[0].x, q.y - pts[0].y) <= reach
  for (let i = 1; i < pts.length; i++) {
    if (segmentDistance(q, pts[i - 1], pts[i]) <= reach) return true
  }
  return false
}
