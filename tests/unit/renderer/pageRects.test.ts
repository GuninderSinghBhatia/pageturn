import { describe, it, expect } from 'vitest'
import { clampPan, focalPan, viewRects } from '@renderer/reader/BookStage/pageRects'

const vp = { width: 1000, height: 800 }
const left = { x: 100, y: 0, width: 400, height: 800 }
const right = { x: 500, y: 0, width: 400, height: 800 }
const fit = { left, right }

describe('viewRects', () => {
  it('is the identity at 100% with no pan', () => {
    expect(viewRects(fit, vp, 1, { x: 0, y: 0 })).toEqual(fit)
  })

  it('zooms about the viewport centre and then pans', () => {
    const r = viewRects(fit, vp, 0.5, { x: 0, y: 0 })
    expect(r.left).toEqual({ x: 300, y: 200, width: 200, height: 400 })
    expect(r.right).toEqual({ x: 500, y: 200, width: 200, height: 400 })
    const p = viewRects(fit, vp, 2, { x: 30, y: -40 })
    expect(p.right).toEqual({ x: 530, y: -440, width: 800, height: 1600 })
  })

  it('keeps a single shared rect shared', () => {
    const single = { left: right, right }
    const r = viewRects(single, vp, 2, { x: 0, y: 0 })
    expect(r.left).toBe(r.right)
  })
})

describe('clampPan', () => {
  it('no panning at or below 100%', () => {
    expect(clampPan(fit, vp, 1, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 })
    expect(clampPan(fit, vp, 0.6, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('zoomed in, the book edge can reach but not pass the window edge', () => {
    // At 200% the book is 1600×1600: it may move ±300 horizontally and ±400 vertically.
    expect(clampPan(fit, vp, 2, { x: 999, y: -999 })).toEqual({ x: 300, y: -400 })
    expect(clampPan(fit, vp, 2, { x: -120, y: 10 })).toEqual({ x: -120, y: 10 })
  })
})

describe('focalPan', () => {
  it('keeps the point under the pointer fixed while zooming (any direction)', () => {
    const centre = { x: 500, y: 400 }
    for (const focus of [
      { x: 120, y: 90 },
      { x: 880, y: 700 },
      { x: 500, y: 400 }
    ]) {
      const pan = { x: 20, y: -30 }
      const next = focalPan(pan, focus, centre, 1.5, 2.25)
      // A book point P sits on screen at centre + P*zoom + pan; the focus point must not move.
      const P = { x: (focus.x - centre.x - pan.x) / 1.5, y: (focus.y - centre.y - pan.y) / 1.5 }
      expect(centre.x + P.x * 2.25 + next.x).toBeCloseTo(focus.x, 6)
      expect(centre.y + P.y * 2.25 + next.y).toBeCloseTo(focus.y, 6)
    }
  })

  it('zooming at the centre needs no pan', () => {
    expect(focalPan({ x: 0, y: 0 }, { x: 500, y: 400 }, { x: 500, y: 400 }, 1, 2)).toEqual({
      x: 0,
      y: 0
    })
  })
})
