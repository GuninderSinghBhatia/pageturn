import { describe, it, expect } from 'vitest'
import { pagesToPrefetch, Prefetcher } from '@renderer/reader/pdf/prefetch'
import type { OpenedDoc } from '@renderer/reader/pdf/pdfService'

describe('pagesToPrefetch', () => {
  it('orders current spread, then alternating forward/back spreads', () => {
    expect(pagesToPrefetch(10, 500, 'spread')).toEqual([10, 11, 12, 13, 8, 9, 14, 15, 6, 7])
  })

  it('handles a 1-page document', () => {
    expect(pagesToPrefetch(1, 1, 'spread')).toEqual([1])
  })

  it('handles the end of an odd document', () => {
    expect(pagesToPrefetch(3, 3, 'spread')).toEqual([2, 3, 1])
  })

  it('works in single layout and respects radius', () => {
    expect(pagesToPrefetch(5, 10, 'single', 1)).toEqual([5, 6, 4])
  })
})

/** Fake doc whose renders resolve only when the test says so. */
function fakeDoc(): {
  doc: OpenedDoc
  started: number[]
  active: () => number
  maxActive: () => number
  finish: (page: number) => Promise<void>
} {
  const pending = new Map<number, () => void>()
  const started: number[] = []
  let active = 0
  let maxActive = 0
  const doc = {
    numPages: 500,
    renderPage: (page: number) =>
      new Promise<ImageBitmap>((resolve) => {
        started.push(page)
        active++
        maxActive = Math.max(maxActive, active)
        pending.set(page, () => {
          active--
          resolve({ width: 1, height: 1, close: () => undefined } as ImageBitmap)
        })
      })
  } as unknown as OpenedDoc
  return {
    doc,
    started,
    active: () => active,
    maxActive: () => maxActive,
    finish: async (page) => {
      pending.get(page)?.()
      pending.delete(page)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

describe('Prefetcher', () => {
  it('renders at most 2 pages concurrently, in priority order', async () => {
    const f = fakeDoc()
    const p = new Prefetcher(f.doc, () => 1)
    p.update(10, 'spread')
    expect(f.started).toEqual([10, 11])
    await f.finish(10)
    expect(f.started).toEqual([10, 11, 12])
    expect(p.ready(10)).toBe(true)
    expect(p.ready(12)).toBe(false)
    await f.finish(11)
    await f.finish(12)
    expect(f.maxActive()).toBe(2)
  })

  it('drops queued jobs from a prior update', async () => {
    const f = fakeDoc()
    const p = new Prefetcher(f.doc, () => 1)
    p.update(10, 'spread') // starts 10, 11; queues 12, 13, 8, 9, ...
    p.update(100, 'spread') // stale queue dropped
    await f.finish(10)
    await f.finish(11)
    expect(f.started.slice(0, 4)).toEqual([10, 11, 100, 101])
    expect(f.started).not.toContain(12)
  })

  it('does not re-render pages already rendered at the same scale', async () => {
    const f = fakeDoc()
    const p = new Prefetcher(f.doc, () => 1)
    p.update(1, 'single') // radius 2 → 1, 2, 3
    for (const n of [1, 2, 3]) await f.finish(n)
    p.update(2, 'single')
    expect(f.started.filter((n) => n === 2)).toHaveLength(1)
  })
})
