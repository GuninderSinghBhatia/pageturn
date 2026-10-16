import type { Bookmark } from '@shared/types'

/** Pastel tab colours, cycled by position (blue, green, yellow, peach). */
export const TAB_COLORS = ['#BFD9E8', '#CFE3C4', '#EDE3B5', '#F0D6C2'] as const

export type BookmarkTab = { index: number; page: number; label: string | null; color: string }

/** Bookmark tabs in page order, numbered from 1, each with its cycling colour. */
export function bookmarkTabs(bookmarks: Record<number, Bookmark>): BookmarkTab[] {
  return Object.values(bookmarks)
    .sort((a, b) => a.page - b.page)
    .map((b, i) => ({
      index: i + 1,
      page: b.page,
      label: b.label,
      color: TAB_COLORS[i % TAB_COLORS.length]
    }))
}
