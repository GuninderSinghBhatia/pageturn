import { describe, it, expect, vi } from 'vitest'
import type { Highlight } from '@shared/types'
import { BakeCache } from '@renderer/reader/BookStage/bake'
import type { PageAnnotations } from '@renderer/stores/annotationStore'

type FakeBmp = ImageBitmap & { tag: string; close: ReturnType<typeof vi.fn> }
const bmp = (tag: string): FakeBmp =>
  ({ tag, width: 100, height: 150, close: vi.fn() }) as unknown as FakeBmp

const none: PageAnnotations = { highlights: [], freeNotes: [], ink: [], bookmark: null }
const some: PageAnnotations = {
  ...none,
  highlights: [{ id: 'h', rects: [], color: 'yellow' } as unknown as Highlight]
}

const make = (): { cache: BakeCache; bake: ReturnType<typeof vi.fn> } => {
  let n = 0
  const bake = vi.fn((src: FakeBmp) => bmp(`${src.tag}-baked-${++n}`))
  return { cache: new BakeCache(bake as never), bake }
}

describe('BakeCache', () => {
  it('returns the raw bitmap untouched when the page has no annotations', () => {
    const { cache, bake } = make()
    const raw = bmp('p2')
    expect(cache.get(2, raw, 0, none)).toBe(raw)
    expect(bake).not.toHaveBeenCalled()
  })

  it('bakes once per (page, bitmap, revision)', () => {
    const { cache, bake } = make()
    const raw = bmp('p2')
    const a = cache.get(2, raw, 1, some)
    const b = cache.get(2, raw, 1, some)
    expect(a).toBe(b)
    expect(a).not.toBe(raw)
    expect(bake).toHaveBeenCalledOnce()
  })

  it('re-bakes on a new revision and closes the replaced bitmap', () => {
    const { cache, bake } = make()
    const raw = bmp('p2')
    const first = cache.get(2, raw, 1, some) as FakeBmp
    const second = cache.get(2, raw, 2, some)
    expect(second).not.toBe(first)
    expect(bake).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledOnce()
    expect(raw.close).not.toHaveBeenCalled() // the raw bitmap belongs to the page cache
  })

  it('re-bakes when the page bitmap changes (e.g. zoom re-render)', () => {
    const { cache, bake } = make()
    cache.get(2, bmp('p2@1'), 1, some)
    cache.get(2, bmp('p2@2'), 1, some)
    expect(bake).toHaveBeenCalledTimes(2)
  })

  it('retain closes entries for pages no longer needed', () => {
    const { cache } = make()
    const p2 = cache.get(2, bmp('p2'), 1, some) as FakeBmp
    const p3 = cache.get(3, bmp('p3'), 1, some) as FakeBmp
    cache.retain(new Set([2]))
    expect(p3.close).toHaveBeenCalledOnce()
    expect(p2.close).not.toHaveBeenCalled()
    expect(cache.bakedPages()).toEqual([2])
  })
})
