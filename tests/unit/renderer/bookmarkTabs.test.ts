import { describe, it, expect } from 'vitest'
import type { Bookmark } from '@shared/types'
import { bookmarkTabs, TAB_COLORS } from '@renderer/reader/annotations/tabList'

const bm = (page: number, label: string | null = null): Bookmark => ({
  id: `b${page}`,
  bookId: 'x',
  page,
  label,
  createdAt: 1
})

describe('bookmarkTabs', () => {
  it('orders tabs by page, numbers them from 1 and cycles the four pastels', () => {
    const tabs = bookmarkTabs({ 40: bm(40), 3: bm(3, 'Intro'), 9: bm(9), 12: bm(12), 70: bm(70) })
    expect(tabs.map((t) => [t.index, t.page])).toEqual([
      [1, 3],
      [2, 9],
      [3, 12],
      [4, 40],
      [5, 70]
    ])
    expect(tabs.map((t) => t.color)).toEqual([...TAB_COLORS, TAB_COLORS[0]])
    expect(tabs[0].label).toBe('Intro')
  })

  it('uses the spec pastels', () => {
    expect(TAB_COLORS).toEqual(['#BFD9E8', '#CFE3C4', '#EDE3B5', '#F0D6C2'])
  })
})
