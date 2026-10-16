import { create } from 'zustand'
import type { InkStroke } from '@shared/types'
import type { InkMode } from './inkInput'

type InkState = {
  mode: InkMode
  /** Stroke being drawn right now (drawn by its page's overlay, not yet saved). */
  live: { page: number; stroke: InkStroke } | null
  setMode(patch: Partial<InkMode>): void
  setLive(live: InkState['live']): void
}

/** Pen mode and the in-progress stroke, shared by the toolbar, input hook and page overlays. */
export const useInkStore = create<InkState>((set, get) => ({
  mode: { active: false, tool: 'pen', color: '#1f1f1f', width: 0.005 },
  live: null,
  setMode: (patch) => set({ mode: { ...get().mode, ...patch } }),
  setLive: (live) => set({ live })
}))
