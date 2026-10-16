import { create } from 'zustand'

type Point = { x: number; y: number } // page-normalized

type OverlayUiState = {
  /** Right-click menu: where it is on screen and which page point it targets. */
  menu: { clientX: number; clientY: number; page: number; point: Point } | null
  /** Free note being edited; no id = a new note not yet saved. */
  openNote: { page: number; point: Point; id?: string } | null
  showMenu(m: OverlayUiState['menu']): void
  openNoteAt(n: OverlayUiState['openNote']): void
  closeAll(): void
}

/** Transient UI for page overlays that outlives a single page component. */
export const useOverlayUi = create<OverlayUiState>((set) => ({
  menu: null,
  openNote: null,
  showMenu: (menu) => set({ menu }),
  openNoteAt: (openNote) => set({ openNote, menu: null }),
  closeAll: () => set({ menu: null, openNote: null })
}))
