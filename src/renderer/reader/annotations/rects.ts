import type { Highlight, Rect } from '@shared/types'

export type DOMRectLike = { left: number; top: number; width: number; height: number }

const MIN_PX = 1
const LINE_OVERLAP = 0.5 // same line: vertical overlap ≥ 50% of the smaller height
const WORD_GAP = 0.01 // merge rects on a line closer than this (page widths)

/** Client rects → page-normalized rects, clipped to the page; slivers under 1px are dropped. */
export function normalizeRects(client: DOMRectLike[], page: DOMRectLike): Rect[] {
  const out: Rect[] = []
  for (const c of client) {
    const left = Math.max(c.left, page.left)
    const top = Math.max(c.top, page.top)
    const right = Math.min(c.left + c.width, page.left + page.width)
    const bottom = Math.min(c.top + c.height, page.top + page.height)
    if (right - left < MIN_PX || bottom - top < MIN_PX) continue
    out.push({
      x: (left - page.left) / page.width,
      y: (top - page.top) / page.height,
      w: (right - left) / page.width,
      h: (bottom - top) / page.height
    })
  }
  return out
}

const sameLine = (a: Rect, b: Rect): boolean => {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlap >= LINE_OVERLAP * Math.min(a.h, b.h)
}

const adjacent = (a: Rect, b: Rect): boolean =>
  b.x <= a.x + a.w + WORD_GAP && a.x <= b.x + b.w + WORD_GAP

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y
  }
}

/** Merges word/span rects that sit on the same line and touch into one rect per run. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  let current = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  // Repeat until stable: a merge can make a run reach a rect it skipped earlier.
  for (;;) {
    const merged: Rect[] = []
    for (const r of current) {
      const i = merged.findIndex((m) => sameLine(m, r) && adjacent(m, r))
      if (i >= 0) merged[i] = union(merged[i], r)
      else merged.push(r)
    }
    if (merged.length === current.length) return merged
    current = merged
  }
}

/** The newest highlight with a rect containing p (page-normalized), or null. */
export function hitHighlight(
  highlights: Highlight[],
  p: { x: number; y: number }
): Highlight | null {
  let best: Highlight | null = null
  for (const h of highlights) {
    const inside = h.rects.some(
      (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    )
    if (inside && (!best || h.createdAt >= best.createdAt)) best = h
  }
  return best
}
