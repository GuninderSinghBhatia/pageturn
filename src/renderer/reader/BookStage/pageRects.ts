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
