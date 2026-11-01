import { create } from 'zustand'

interface AskState {
  /** Whether the reader's Ask-the-book drawer is open (toolbar button). */
  open: boolean
  /** A selected name waiting to be looked up ("Who is this?"); the panel clears it once it starts. */
  pendingName: string | null
  toggle(): void
  close(): void
  /** Opens the drawer and looks up who/what `name` is, using only the pages read so far. */
  askWho(name: string): void
  clearPendingName(): void
}

export const useAskStore = create<AskState>((set) => ({
  open: false,
  pendingName: null,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  askWho: (name) => set({ open: true, pendingName: name }),
  clearPendingName: () => set({ pendingName: null })
}))
