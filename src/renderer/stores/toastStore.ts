import { create } from 'zustand'

export type Toast = { id: string; text: string }

type ToastState = {
  toasts: Toast[]
  show(text: string): void
  dismiss(id: string): void
}

const AUTO_DISMISS_MS = 4000

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text) => {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, text }] })
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))
