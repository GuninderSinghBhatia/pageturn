import { create } from 'zustand'

export type View = 'library' | { reader: string }

type NavState = { view: View; goLibrary(): void; goReader(bookId: string): void }

/** Tiny view router: the library grid, or the reader for one book. */
export const useNav = create<NavState>((set) => ({
  view: 'library',
  goLibrary: () => set({ view: 'library' }),
  goReader: (bookId) => set({ view: { reader: bookId } })
}))
