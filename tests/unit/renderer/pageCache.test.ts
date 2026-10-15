import { describe, it, expect, vi } from 'vitest'
import { PageCache } from '@renderer/reader/pdf/pageCache'

const bmp = (width: number, height: number): ImageBitmap =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap

describe('PageCache', () => {
  it('tracks bytes as w*h*4', () => {
    const c = new PageCache(1000)
    c.set(1, 1, bmp(10, 10))
    expect(c.bytes).toBe(400)
    expect(c.has(1, 1)).toBe(true)
    expect(c.has(1, 2)).toBe(false)
  })

  it('evicts least-recently-used entries over budget and closes them', () => {
    const c = new PageCache(1000) // 2 x 400-byte bitmaps fit, 3 do not
    const a = bmp(10, 10)
    const b = bmp(10, 10)
    const d = bmp(10, 10)
    c.set(1, 1, a)
    c.set(2, 1, b)
    c.set(3, 1, d)
    expect(c.has(1, 1)).toBe(false)
    expect(a.close).toHaveBeenCalledOnce()
    expect(c.bytes).toBe(800)
  })

  it('get refreshes recency', () => {
    const c = new PageCache(1000)
    const a = bmp(10, 10)
    const b = bmp(10, 10)
    c.set(1, 1, a)
    c.set(2, 1, b)
    expect(c.get(1, 1)).toBe(a)
    c.set(3, 1, bmp(10, 10))
    expect(c.has(1, 1)).toBe(true)
    expect(c.has(2, 1)).toBe(false)
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('replacing a key closes the old bitmap; clear closes all', () => {
    const c = new PageCache(10_000)
    const a = bmp(10, 10)
    const b = bmp(10, 10)
    c.set(1, 1, a)
    c.set(1, 1, b)
    expect(a.close).toHaveBeenCalledOnce()
    expect(c.bytes).toBe(400)
    c.clear()
    expect(b.close).toHaveBeenCalledOnce()
    expect(c.bytes).toBe(0)
  })
})
