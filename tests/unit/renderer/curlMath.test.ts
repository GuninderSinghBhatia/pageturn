import { describe, it, expect } from 'vitest'
import {
  curlVertex,
  foldFromDrag,
  progressFromPointer,
  scriptedPath,
  shouldComplete,
  type Fold
} from '@renderer/reader/BookStage/webgl/curlMath'

const r = 0.06
// Vertical fold at x = 0.5; the lifted side is to the right (+x).
const fold: Fold = {
  origin: { x: 0.5, y: 0 },
  dir: { x: 0, y: 1 },
  normal: { x: 1, y: 0 },
  radius: r
}

describe('curlVertex', () => {
  it('leaves points before the fold unchanged', () => {
    const v = curlVertex({ x: 0.3, y: 0.7 }, fold)
    expect(v.pos).toEqual([0.3, 0.7, 0])
    expect(v.normal).toEqual([0, 0, 1])
    expect(v.back).toBe(false)
  })

  it('lifts a point a quarter way round the cylinder to height r', () => {
    const v = curlVertex({ x: 0.5 + (Math.PI * r) / 2, y: 0.4 }, fold)
    expect(v.pos[0]).toBeCloseTo(0.5 + r)
    expect(v.pos[1]).toBeCloseTo(0.4)
    expect(v.pos[2]).toBeCloseTo(r)
    expect(v.back).toBe(false)
  })

  it('flips points past half the circumference flat onto the back, at height 2r', () => {
    const v = curlVertex({ x: 0.5 + Math.PI * r + 0.1, y: 0.2 }, fold)
    expect(v.pos[0]).toBeCloseTo(0.4) // mirrored back over the fold
    expect(v.pos[1]).toBeCloseTo(0.2)
    expect(v.pos[2]).toBeCloseTo(2 * r)
    expect(v.back).toBe(true)
  })
})

describe('progressFromPointer', () => {
  it('is 0 at the corner and 1 at the mirrored position, clamped', () => {
    expect(progressFromPointer('br', { x: 1, y: 1.5 })).toBe(0)
    expect(progressFromPointer('br', { x: -1, y: 1.5 })).toBe(1)
    expect(progressFromPointer('br', { x: 0, y: 1 })).toBeCloseTo(0.5)
    expect(progressFromPointer('br', { x: -3, y: 1 })).toBe(1)
    expect(progressFromPointer('tl', { x: 0, y: 0 })).toBe(0)
    expect(progressFromPointer('tl', { x: 2, y: 0 })).toBe(1)
  })
})

describe('foldFromDrag', () => {
  it('is the perpendicular bisector of corner→pointer, normal toward the corner', () => {
    const f = foldFromDrag('br', { x: 0.6, y: 1.5 }, 1.5)
    expect(f.origin.x).toBeCloseTo(0.8)
    expect(f.origin.y).toBeCloseTo(1.5)
    expect(f.normal.x).toBeCloseTo(1)
    expect(f.normal.y).toBeCloseTo(0)
    expect(Math.abs(f.dir.y)).toBeCloseTo(1)
    // radius shrinks with progress (0.2 here)
    expect(f.radius).toBeCloseTo(0.06 * (1 - 0.7 * 0.2))
  })

  it('maps the corner close to the pointer once curled', () => {
    const pointer = { x: 0.2, y: 1.1 }
    const v = curlVertex({ x: 1, y: 1.5 }, foldFromDrag('br', pointer, 1.5, 0.001))
    expect(v.pos[0]).toBeCloseTo(pointer.x, 2)
    expect(v.pos[1]).toBeCloseTo(pointer.y, 2)
  })

  it('does not blow up when the pointer is on the corner', () => {
    const f = foldFromDrag('tr', { x: 1, y: 0 }, 1.5)
    expect(Number.isFinite(f.normal.x)).toBe(true)
    expect(curlVertex({ x: 0.9, y: 0.1 }, f).pos[2]).toBe(0)
  })
})

describe('scriptedPath', () => {
  it('runs from the corner to the mirrored corner, monotonic in x, lifted mid-way', () => {
    const aspect = 1.5
    expect(scriptedPath('br', 0, aspect)).toEqual({ x: 1, y: aspect })
    const end = scriptedPath('br', 1, aspect)
    expect(end.x).toBeCloseTo(-1)
    expect(end.y).toBeCloseTo(aspect)
    let prev = Infinity
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = scriptedPath('br', t, aspect)
      expect(p.x).toBeLessThanOrEqual(prev + 1e-9)
      prev = p.x
    }
    expect(scriptedPath('br', 0.5, aspect).y).toBeCloseTo(aspect - 0.15 * aspect)
    expect(scriptedPath('tl', 0.5, aspect).y).toBeCloseTo(0.15 * aspect)
    expect(scriptedPath('tl', 1, aspect).x).toBeCloseTo(2)
  })
})

describe('shouldComplete', () => {
  it('completes past half way or on a fast flick in the turn direction', () => {
    expect(shouldComplete(0.4, 2, 1)).toBe(true)
    expect(shouldComplete(0.4, 0.2, 1)).toBe(false)
    expect(shouldComplete(0.6, -3, 1)).toBe(true) // progress wins
    expect(shouldComplete(0.4, -2, -1)).toBe(true)
  })
})
