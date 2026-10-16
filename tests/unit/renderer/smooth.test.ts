import { describe, it, expect } from 'vitest'
import { approach } from '@renderer/reader/BookStage/smooth'

describe('approach', () => {
  it('moves part of the way toward the target each frame, faster for longer frames', () => {
    const a = approach(1, 2, 16)
    const b = approach(1, 2, 32)
    expect(a).toBeGreaterThan(1)
    expect(a).toBeLessThan(2)
    expect(b).toBeGreaterThan(a)
  })

  it('arrives in about a fifth of a second at 60 fps', () => {
    let z = 1
    for (let i = 0; i < 12; i++) z = approach(z, 1.25, 16.7)
    expect(z).toBe(1.25)
  })

  it('snaps when close and never overshoots (either direction)', () => {
    expect(approach(1.2499, 1.25, 16)).toBe(1.25)
    let z = 2
    for (let i = 0; i < 40; i++) {
      const next = approach(z, 1, 16)
      expect(next).toBeLessThanOrEqual(z)
      expect(next).toBeGreaterThanOrEqual(1)
      z = next
    }
  })
})
