import { create } from 'zustand'

export type ToastAction = { label: string; run: () => void }
export type Toast = { id: string; text: string; kind: 'info' | 'error'; action?: ToastAction }

type ToastState = {
  toasts: Toast[]
  /** Returns the toast's id (for dismissing it later). */
  show(
    text: string,
    opts?: { kind?: Toast['kind']; action?: ToastAction; sticky?: boolean }
  ): string
  dismiss(id: string): void
}

const AUTO_DISMISS_MS = 4000

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, opts = {}) => {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, text, kind: opts.kind ?? 'info', action: opts.action }] })
    if (!opts.sticky) setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Shorthand used across the renderer. */
export const toast = (text: string, opts?: Parameters<ToastState['show']>[1]): string =>
  useToastStore.getState().show(text, opts)
