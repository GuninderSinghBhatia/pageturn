import { create } from 'zustand'
import type { InkStroke } from '@shared/types'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useReaderStore } from '../../stores/readerStore'
import { spreadFor, spreadPages } from '../layout'
import { InkHistory, type InkOp } from './history'
import type { InkMode } from './inkInput'
import { strokeHit } from './strokes'

const ERASER_RADIUS = 0.012 // page widths

type InkState = {
  mode: InkMode
  /** Stroke being drawn right now (drawn by its page overlay, not yet saved). */
  live: { page: number; stroke: InkStroke } | null
  setMode(patch: Partial<InkMode>): void
  setLive(live: InkState['live']): void
  /** Saves a finished stroke and records it for undo. */
  commit(page: number, stroke: Omit<InkStroke, 'id' | 'bookId' | 'createdAt'>): void
  /** Removes strokes under the eraser; one eraser gesture becomes one undo step. */
  eraseAt(page: number, p: { x: number; y: number }, aspect: number): void
  endErase(page: number): void
  undo(): boolean
  redo(): boolean
  /** Forgets undo history (the book closed). */
  reset(): void
}

const history = new InkHistory()
let erased: InkStroke[] = [] // strokes removed by the current eraser gesture

const visiblePages = (): number[] => {
  const r = useReaderStore.getState()
  return r.doc ? spreadPages(spreadFor(r.page, r.doc.numPages, r.layout)) : []
}

/** Applies an op forwards (redo) or backwards (undo) to the annotation store. */
function apply(op: InkOp, forwards: boolean): void {
  const a = useAnnotationStore.getState()
  const adds = (op.kind === 'add') === forwards
  if (adds) a.restoreInk(op.strokes)
  else a.removeInk(op.strokes.map((s) => s.id))
}

/** Pen mode, the in-progress stroke and ink undo/redo, shared by toolbar, input and overlays. */
export const useInkStore = create<InkState>((set, get) => ({
  mode: { active: false, tool: 'pen', color: '#1f1f1f', width: 0.005 },
  live: null,
  setMode: (patch) => set({ mode: { ...get().mode, ...patch } }),
  setLive: (live) => set({ live }),

  commit: (page, stroke) => {
    const created = useAnnotationStore.getState().addInk([{ ...stroke, page }])
    if (created.length) history.push({ kind: 'add', page, strokes: created, at: Date.now() })
  },

  eraseAt: (page, p, aspect) => {
    const a = useAnnotationStore.getState()
    const hits = Object.values(a.ink).filter(
      (s) => s.page === page && strokeHit(s, p, ERASER_RADIUS, aspect)
    )
    if (hits.length === 0) return
    erased.push(...hits)
    a.removeInk(hits.map((s) => s.id))
  },

  endErase: (page) => {
    if (erased.length) history.push({ kind: 'erase', page, strokes: erased, at: Date.now() })
    erased = []
  },

  undo: () => {
    const op = history.undo(visiblePages())
    if (op) apply(op, false)
    return !!op
  },

  redo: () => {
    const op = history.redo(visiblePages())
    if (op) apply(op, true)
    return !!op
  },

  reset: () => {
    history.clear()
    erased = []
  }
}))
