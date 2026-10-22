import { create } from 'zustand'

/** Whether the reader's Notebook drawer is open (Ctrl+B / toolbar button). */
export const useNotebookStore = create<{ open: boolean; toggle(): void; close(): void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))
