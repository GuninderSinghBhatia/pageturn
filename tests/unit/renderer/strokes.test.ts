import { describe, it, expect } from 'vitest'
import type { InkStroke } from '@shared/types'
import { needsSimulatedPressure, strokeHit, strokeOutline } from '@renderer/reader/ink/strokes'

const stroke = (points: InkStroke['points'], width = 0.005): InkStroke => ({
  id: 's',
  bookId: 'b',
  page: 1,
  points,
  color: '#1f1f1f',
  width,
  tool: 'pen',
  createdAt: 1
})

describe('strokeOutline', () => {
  it('returns a polygon in pixels hugging the stroke', () => {
    const size = { w: 400, h: 600 }
    const outline = strokeOutline(
      [
        [0.1, 0.1, 0.5],
        [0.5, 0.1, 0.5]
      ],
      0.01,
      size,
      true
    )
    expect(outline.length).toBeGreaterThanOrEqual(4)
    const pad = 0.01 * size.w
    for (const [x, y] of outline) {
      expect(x).toBeGreaterThanOrEqual(40 - pad)
      expect(x).toBeLessThanOrEqual(200 + pad)
      expect(y).toBeGreaterThanOrEqual(60 - pad)
      expect(y).toBeLessThanOrEqual(60 + pad)
    }
  })
})

describe('strokeHit', () => {
  const s = stroke([
    [0.2, 0.5, 0.5],
    [0.6, 0.5, 0.5]
  ])

  it('hits at the midpoint of the stroke', () => {
    expect(strokeHit(s, { x: 0.4, y: 0.5 }, 0.01, 1.5)).toBe(true)
  })

  it('misses 0.05 page-widths away with a 0.01 radius', () => {
    expect(strokeHit(s, { x: 0.4, y: 0.5 + 0.05 / 1.5 }, 0.01, 1.5)).toBe(false)
  })

  it('hits a single-point stroke (a dot)', () => {
    expect(strokeHit(stroke([[0.3, 0.3, 0.5]]), { x: 0.305, y: 0.3 }, 0.01, 1.5)).toBe(true)
  })
})

describe('needsSimulatedPressure', () => {
  it('is true for mouse strokes (constant 0.5) and false for real pen pressure', () => {
    expect(
      needsSimulatedPressure([
        [0, 0, 0.5],
        [1, 1, 0.5]
      ])
    ).toBe(true)
    expect(
      needsSimulatedPressure([
        [0, 0, 0.3],
        [1, 1, 0.7]
      ])
    ).toBe(false)
  })
})
