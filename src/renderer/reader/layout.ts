import type { LayoutMode } from '@shared/types'

export type ResolvedLayout = 'spread' | 'single'
export type Spread = { left: number | null; right: number | null } // 1-based page numbers

const MIN_SPREAD_WIDTH = 1000 // px: narrower windows show one page

export function resolveLayout(mode: LayoutMode, aspect: number, width = Infinity): ResolvedLayout {
  if (mode === 'auto') return aspect >= 1.2 && width >= MIN_SPREAD_WIDTH ? 'spread' : 'single'
  return mode
}

/** First page of the spread containing `page` (page 1 is a cover alone on the right). */
export function spreadStart(page: number, layout: ResolvedLayout): number {
  if (layout === 'single' || page <= 1) return Math.max(1, page)
  return page % 2 === 0 ? page : page - 1
}

export function spreadFor(page: number, numPages: number, layout: ResolvedLayout): Spread {
  const start = spreadStart(page, layout)
  if (layout === 'single' || start === 1) return { left: null, right: start }
  return { left: start, right: start + 1 <= numPages ? start + 1 : null }
}

export function nextSpreadStart(
  page: number,
  numPages: number,
  layout: ResolvedLayout
): number | null {
  const start = spreadStart(page, layout)
  const next = layout === 'single' ? start + 1 : start === 1 ? 2 : start + 2
  return next <= numPages ? next : null
}

export function prevSpreadStart(
  page: number,
  _numPages: number,
  layout: ResolvedLayout
): number | null {
  const start = spreadStart(page, layout)
  if (start <= 1) return null
  if (layout === 'single') return start - 1
  return start === 2 ? 1 : start - 2
}

/** Pages visible in a spread, in reading order. */
export function spreadPages(s: Spread): number[] {
  return [s.left, s.right].filter((p): p is number => p !== null)
}

/** Per-page CSS size that fits the book (one or two pages + margins) in the viewport. */
export function fitPageSize(
  pageSize: { width: number; height: number },
  viewport: { width: number; height: number },
  layout: ResolvedLayout,
  margin = 0
): { width: number; height: number } {
  const availW = Math.max(1, viewport.width - 2 * margin) / (layout === 'spread' ? 2 : 1)
  const availH = Math.max(1, viewport.height - 2 * margin)
  const scale = Math.min(availW / pageSize.width, availH / pageSize.height)
  return { width: pageSize.width * scale, height: pageSize.height * scale }
}
