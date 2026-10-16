import { create } from 'zustand'

export type View = 'library' | { reader: string }

type NavState = {
  view: View
  settingsOpen: boolean
  goLibrary(): void
  goReader(bookId: string): void
  openSettings(): void
  closeSettings(): void
}

/**
 * Tiny view router: the library grid, or the reader for one book. Settings is an overlay on top
 * of either, so an open book stays loaded (and reflects changes live) while settings are shown.
 */
export const useNav = create<NavState>((set) => ({
  view: 'library',
  settingsOpen: false,
  goLibrary: () => set({ view: 'library', settingsOpen: false }),
  goReader: (bookId) => set({ view: { reader: bookId }, settingsOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false })
}))
