import { create } from 'zustand'

/** Whether the reader's Ask-the-book drawer is open (toolbar button). */
export const useAskStore = create<{ open: boolean; toggle(): void; close(): void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))
