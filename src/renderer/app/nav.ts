import { create } from 'zustand'

export type View = 'library' | { reader: string; page?: number }
export type HomeTab = 'books' | 'notes' | 'online' | 'settings'

type NavState = {
  view: View
  settingsOpen: boolean
  homeTab: HomeTab
  goLibrary(): void
  goReader(bookId: string, page?: number): void
  openSettings(): void
  setHomeTab(tab: HomeTab): void
  closeSettings(): void
}

/**
 * Tiny view router: the library grid, or the reader for one book. Settings is an overlay on top
 * of either, so an open book stays loaded (and reflects changes live) while settings are shown.
 */
export const useNav = create<NavState>((set) => ({
  view: 'library',
  settingsOpen: false,
  homeTab: 'books',
  goLibrary: () => set({ view: 'library', settingsOpen: false }),
  goReader: (bookId, page) => set({ view: { reader: bookId, page }, settingsOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  setHomeTab: (homeTab) => set({ homeTab }),
  closeSettings: () => set({ settingsOpen: false })
}))
