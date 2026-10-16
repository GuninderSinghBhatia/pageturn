import { describe, it, expect } from 'vitest'
import {
  resolveLayout,
  spreadFor,
  nextSpreadStart,
  prevSpreadStart,
  fitPageSize
} from '@renderer/reader/layout'

describe('spreadFor', () => {
  it('shows page 1 alone on the right, then pairs (2,3), (4,5)...', () => {
    expect(spreadFor(1, 500, 'spread')).toEqual({ left: null, right: 1 })
    expect(spreadFor(3, 500, 'spread')).toEqual({ left: 2, right: 3 })
    expect(spreadFor(2, 500, 'spread')).toEqual({ left: 2, right: 3 })
  })

  it('shows a final even page alone on the left', () => {
    expect(spreadFor(500, 500, 'spread')).toEqual({ left: 500, right: null })
  })

  it('handles a 1-page PDF', () => {
    expect(spreadFor(1, 1, 'spread')).toEqual({ left: null, right: 1 })
    expect(nextSpreadStart(1, 1, 'spread')).toBeNull()
    expect(prevSpreadStart(1, 1, 'spread')).toBeNull()
  })

  it('handles odd page counts', () => {
    expect(spreadFor(3, 3, 'spread')).toEqual({ left: 2, right: 3 })
    expect(nextSpreadStart(2, 3, 'spread')).toBeNull()
    expect(prevSpreadStart(3, 3, 'spread')).toBe(1)
  })

  it('single layout shows one page and steps by one', () => {
    expect(spreadFor(4, 10, 'single')).toEqual({ left: null, right: 4 })
    expect(nextSpreadStart(4, 10, 'single')).toBe(5)
    expect(nextSpreadStart(10, 10, 'single')).toBeNull()
    expect(prevSpreadStart(1, 10, 'single')).toBeNull()
  })

  it('steps through spreads', () => {
    expect(nextSpreadStart(1, 500, 'spread')).toBe(2)
    expect(nextSpreadStart(3, 500, 'spread')).toBe(4)
    expect(prevSpreadStart(5, 500, 'spread')).toBe(2)
    expect(prevSpreadStart(2, 500, 'spread')).toBe(1)
  })
})

describe('resolveLayout', () => {
  it('auto switches to spread at aspect 1.2', () => {
    expect(resolveLayout('auto', 1.19)).toBe('single')
    expect(resolveLayout('auto', 1.2)).toBe('spread')
    expect(resolveLayout('single', 2)).toBe('single')
    expect(resolveLayout('spread', 0.5)).toBe('spread')
  })

  it('auto shows a single page in windows narrower than 1000px', () => {
    expect(resolveLayout('auto', 1.6, 999)).toBe('single')
    expect(resolveLayout('auto', 1.6, 1000)).toBe('spread')
    expect(resolveLayout('spread', 1.6, 800)).toBe('spread')
  })
})

describe('fitPageSize', () => {
  const page = { width: 432, height: 648 } // 2:3

  it('keeps aspect and fits two pages plus margins in spread mode', () => {
    const s = fitPageSize(page, { width: 1264, height: 664 }, 'spread')
    expect(s.width / s.height).toBeCloseTo(432 / 648)
    expect(s.height).toBeCloseTo(664) // fills the window height: no margin
    expect(2 * s.width).toBeLessThanOrEqual(1264)
  })

  it('is width-limited when the window is narrow', () => {
    const s = fitPageSize(page, { width: 464, height: 2000 }, 'spread', 32)
    expect(s.width).toBeCloseTo(200) // (464 - 64) / 2
    expect(s.width / s.height).toBeCloseTo(432 / 648)
    expect(fitPageSize(page, { width: 464, height: 2000 }, 'single').width).toBeCloseTo(464) // full width, no margin
  })
})
