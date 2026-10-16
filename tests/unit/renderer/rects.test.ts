import { describe, it, expect } from 'vitest'
import type { Highlight } from '@shared/types'
import {
  hitHighlight,
  mergeLineRects,
  normalizeRects,
  type DOMRectLike
} from '@renderer/reader/annotations/rects'

const page = { left: 100, top: 50, width: 400, height: 600 }
const r = (left: number, top: number, width: number, height: number): DOMRectLike => ({
  left,
  top,
  width,
  height
})

describe('normalizeRects', () => {
  it('divides by page size relative to the page origin', () => {
    expect(normalizeRects([r(140, 110, 200, 12)], page)).toEqual([
      { x: 0.1, y: 0.1, w: 0.5, h: 0.02 }
    ])
  })

  it('clips a rect that extends past the page and drops slivers under 1px', () => {
    const out = normalizeRects([r(400, 110, 200, 12), r(150, 200, 0.5, 12)], page)
    expect(out).toHaveLength(1)
    expect(out[0].x + out[0].w).toBeCloseTo(1, 10)
    expect(out[0].w).toBeCloseTo(0.25, 10)
  })
})

describe('mergeLineRects', () => {
  it('merges word rects on one line into one rect', () => {
    const merged = mergeLineRects([
      { x: 0.1, y: 0.1, w: 0.1, h: 0.02 },
      { x: 0.205, y: 0.1005, w: 0.1, h: 0.019 },
      { x: 0.31, y: 0.1, w: 0.05, h: 0.02 }
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].x).toBeCloseTo(0.1)
    expect(merged[0].x + merged[0].w).toBeCloseTo(0.36)
  })

  it('keeps separate lines apart', () => {
    expect(
      mergeLineRects([
        { x: 0.1, y: 0.1, w: 0.5, h: 0.02 },
        { x: 0.1, y: 0.125, w: 0.5, h: 0.02 }
      ])
    ).toHaveLength(2)
  })

  it('does not merge across a column gap', () => {
    expect(
      mergeLineRects([
        { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
        { x: 0.5, y: 0.1, w: 0.2, h: 0.02 }
      ])
    ).toHaveLength(2)
  })
})

describe('hitHighlight', () => {
  const h = (id: string, createdAt: number, x: number): Highlight => ({
    id,
    bookId: 'b',
    page: 1,
    rects: [{ x, y: 0.1, w: 0.3, h: 0.02 }],
    text: '',
    color: 'yellow',
    noteId: null,
    createdAt,
    updatedAt: createdAt
  })

  it('returns the newest highlight under the point', () => {
    const list = [h('old', 1, 0.1), h('new', 2, 0.2)]
    expect(hitHighlight(list, { x: 0.25, y: 0.11 })?.id).toBe('new')
    expect(hitHighlight(list, { x: 0.15, y: 0.11 })?.id).toBe('old')
  })

  it('returns null outside every rect', () => {
    expect(hitHighlight([h('a', 1, 0.1)], { x: 0.9, y: 0.9 })).toBeNull()
  })
})
