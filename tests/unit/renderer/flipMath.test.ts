import { describe, it, expect } from 'vitest'
import { flipPoint, flipShadows, BEND } from '@renderer/reader/BookStage/webgl/flipMath'

/** Arc length from the spine to a point, by sampling the curve. */
function arcLength(xs: number, progress: number): number {
  let len = 0
  let prev = flipPoint(0, progress)
  for (let i = 1; i <= 200; i++) {
    const p = flipPoint((xs * i) / 200, progress)
    len += Math.hypot(p.x - prev.x, p.z - prev.z)
    prev = p
  }
  return len
}

describe('flipPoint', () => {
  it('at rest the page lies flat where it is', () => {
    expect(flipPoint(0.7, 0)).toEqual({ x: 0.7, z: 0, back: false })
  })

  it('when finished the page lies flat on the other side, back up', () => {
    const p = flipPoint(0.7, 1)
    expect(p.x).toBeCloseTo(-0.7, 6)
    expect(p.z).toBeCloseTo(0, 6)
    expect(p.back).toBe(true)
  })

  it('half way the page stands up off the book and the outer edge leads', () => {
    const edge = flipPoint(1, 0.5)
    expect(edge.z).toBeGreaterThan(0.5)
    expect(edge.x).toBeLessThan(0) // already past the spine: paper pulled from the edge
    expect(BEND).toBeGreaterThan(0)
  })

  it('the paper never stretches: arc length from the spine is preserved', () => {
    for (const progress of [0.1, 0.35, 0.5, 0.8]) {
      expect(arcLength(1, progress)).toBeCloseTo(1, 2)
    }
  })

  it('the front faces the reader early, the back late', () => {
    expect(flipPoint(0.5, 0.2).back).toBe(false)
    expect(flipPoint(0.5, 0.85).back).toBe(true)
  })
})

describe('flipShadows', () => {
  it('no shadows at rest; the page being uncovered darkens early, the landing page late', () => {
    expect(flipShadows(0)).toEqual({ under: 0, landing: 0 })
    expect(flipShadows(1)).toEqual({ under: 0, landing: 0 })
    const early = flipShadows(0.25)
    const late = flipShadows(0.75)
    expect(early.under).toBeGreaterThan(early.landing)
    expect(late.landing).toBeGreaterThan(late.under)
  })
})
