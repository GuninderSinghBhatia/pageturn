import { create } from 'zustand'

type Point = { x: number; y: number } // page-normalized

export type CardKind = 'ai' | 'lookup'

type OverlayUiState = {
  /** Right-click menu on a page with no selection ("Add note here"). */
  menu: { clientX: number; clientY: number; page: number; point: Point } | null
  /** Right-click menu on a text selection. */
  selectionMenu: { clientX: number; clientY: number } | null
  /** Free note being edited; no id = a new note not yet saved. */
  openNote: { page: number; point: Point; id?: string } | null
  /** Highlight whose card is open (from a click, the margin dot or "Make a note"). */
  openHighlight: { id: string; editNote: boolean } | null
  /** Ask AI / Look up card for a phrase, anchored at a viewport point. */
  card: { kind: CardKind; text: string; x: number; y: number } | null
  showMenu(m: OverlayUiState['menu']): void
  showSelectionMenu(m: OverlayUiState['selectionMenu']): void
  openNoteAt(n: OverlayUiState['openNote']): void
  openHighlightCard(h: OverlayUiState['openHighlight']): void
  showCard(c: OverlayUiState['card']): void
  /** Closes every menu and card; true if anything was open. */
  closeAll(): boolean
}

const CLOSED = { menu: null, selectionMenu: null, openNote: null, openHighlight: null, card: null }

/** Transient UI for page overlays that outlives a single page component. */
export const useOverlayUi = create<OverlayUiState>((set, get) => ({
  ...CLOSED,
  showMenu: (menu) => set({ menu }),
  showSelectionMenu: (selectionMenu) => set({ selectionMenu }),
  openNoteAt: (openNote) => set({ ...CLOSED, openNote }),
  openHighlightCard: (openHighlight) => set({ ...CLOSED, openHighlight }),
  showCard: (card) => set({ ...CLOSED, card }),
  closeAll: () => {
    const s = get()
    const open = !!(s.menu || s.selectionMenu || s.openNote || s.openHighlight || s.card)
    set(CLOSED)
    return open
  }
}))
