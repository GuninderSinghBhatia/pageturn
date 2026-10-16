import { create } from 'zustand'
import type { LayoutMode } from '@shared/types'
import {
  nextSpreadStart,
  prevSpreadStart,
  spreadStart,
  type ResolvedLayout
} from '../reader/layout'
import { openPdf, PasswordCancelledError, type OpenedDoc } from '../reader/pdf/pdfService'

export const MIN_ZOOM = 1 // the fitted book is the smallest it gets
export const MAX_ZOOM = 4
const SAVE_DEBOUNCE_MS = 500

type Status = 'idle' | 'loading' | 'ready' | 'cancelled' | 'error'

type ReaderState = {
  doc: OpenedDoc | null
  bookId: string | null
  page: number // first page of the current spread
  layout: ResolvedLayout
  layoutMode: LayoutMode // user preference; `layout` is resolved from it + window aspect
  zoom: number // 1 = fit
  turning: boolean
  status: Status
  error: string | null
  passwordRequest: { retry: boolean } | null
  open(bookId: string): Promise<void>
  goTo(page: number): void
  next(): void
  prev(): void
  setZoom(z: number): void
  setLayout(layout: ResolvedLayout): void
  setLayoutMode(mode: LayoutMode): void
  submitPassword(password: string | null): void
  close(): void
  /** Animated turn: routed to the active stage (curl) if one registered, else next/prev. */
  requestTurn(dir: 1 | -1): void
  turnHandler: ((dir: 1 | -1) => void) | null
  setTurnHandler(h: ((dir: 1 | -1) => void) | null): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: (() => void) | null = null
let passwordResolver: ((pw: string | null) => void) | null = null

function scheduleSave(bookId: string, page: number): void {
  if (saveTimer) clearTimeout(saveTimer)
  pendingSave = () => void window.api.reader.saveProgress(bookId, page)
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
}

function flushSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  pendingSave?.()
  pendingSave = null
}

const initial = {
  doc: null,
  bookId: null,
  page: 1,
  zoom: 1,
  turning: false,
  status: 'idle' as Status,
  error: null,
  passwordRequest: null
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  ...initial,
  layout: 'spread',
  layoutMode: 'auto',

  open: async (bookId) => {
    get().close()
    set({ ...initial, bookId, status: 'loading' })
    try {
      const book = (await window.api.library.list()).find((b) => b.id === bookId)
      const data = await window.api.library.getFile(bookId)
      const doc = await openPdf(data, {
        onPassword: (retry) =>
          new Promise((resolve) => {
            passwordResolver = resolve
            set({ passwordRequest: { retry } })
          })
      })
      if (get().bookId !== bookId) return doc.destroy() // closed while loading
      const page = spreadStart(
        Math.min(Math.max(1, book?.lastPage ?? 1), doc.numPages),
        get().layout
      )
      set({ doc, page, status: 'ready', passwordRequest: null })
      if (book && book.numPages !== doc.numPages) {
        void window.api.library.updateMeta(bookId, { ...doc.metadata, numPages: doc.numPages })
      }
      scheduleSave(bookId, page) // also stamps last_opened_at
    } catch (err) {
      if (get().bookId !== bookId) return
      if (err instanceof PasswordCancelledError) set({ status: 'cancelled', passwordRequest: null })
      else set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  goTo: (target) => {
    const { doc, bookId, layout } = get()
    if (!doc || !bookId) return
    const clamped = Math.min(Math.max(1, Math.round(target)), doc.numPages)
    const page = spreadStart(clamped, layout)
    if (page !== get().page) set({ page })
    scheduleSave(bookId, page)
  },

  turnHandler: null,
  setTurnHandler: (turnHandler) => set({ turnHandler }),
  requestTurn: (dir) => {
    const { turnHandler } = get()
    if (turnHandler) turnHandler(dir)
    else if (dir === 1) get().next()
    else get().prev()
  },

  next: () => {
    const { doc, page, layout } = get()
    const n = doc && nextSpreadStart(page, doc.numPages, layout)
    if (n) get().goTo(n)
  },

  prev: () => {
    const { doc, page, layout } = get()
    const p = doc && prevSpreadStart(page, doc.numPages, layout)
    if (p) get().goTo(p)
  },

  setZoom: (z) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }),

  setLayout: (layout) => {
    if (layout === get().layout) return
    set({ layout, page: spreadStart(get().page, layout) })
  },

  setLayoutMode: (layoutMode) => set({ layoutMode }),

  submitPassword: (password) => {
    const resolve = passwordResolver
    passwordResolver = null
    set({ passwordRequest: null })
    resolve?.(password)
  },

  close: () => {
    flushSave()
    if (passwordResolver) get().submitPassword(null)
    get().doc?.destroy()
    set({ ...initial })
  }
}))
