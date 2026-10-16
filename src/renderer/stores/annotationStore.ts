import { create } from 'zustand'
import type { Bookmark, Highlight, HighlightColor, InkStroke, Note } from '@shared/types'
import { useToastStore } from './toastStore'

export type PageAnnotations = {
  highlights: Highlight[]
  freeNotes: Note[] // notes placed at a point (not attached to a highlight)
  ink: InkStroke[]
  bookmark: Bookmark | null
}

type NewHighlight = Pick<Highlight, 'page' | 'rects' | 'text' | 'color'> & {
  style?: Highlight['style']
}
type NewInk = Omit<InkStroke, 'id' | 'bookId' | 'createdAt'>
type NoteInput = { id?: string; page: number; anchor: Note['anchor']; body: string }

type AnnotationState = {
  bookId: string | null
  highlights: Record<string, Highlight>
  notes: Record<string, Note>
  ink: Record<string, InkStroke>
  bookmarks: Record<number, Bookmark>
  /** Bumped for a page on every change touching it (drives redraws and texture re-bakes). */
  revision: Record<number, number>
  load(bookId: string): Promise<void>
  clear(): void
  addHighlights(hs: NewHighlight[]): Highlight[]
  setHighlightColor(id: string, color: HighlightColor): void
  deleteHighlight(id: string): void
  saveNote(n: NoteInput): Note
  deleteNote(id: string): void
  addInk(strokes: NewInk[]): InkStroke[]
  removeInk(ids: string[]): void
  restoreInk(strokes: InkStroke[]): void
  toggleBookmark(page: number): void
  renameBookmark(page: number, label: string | null): void
}

const RETRY_DELAYS_MS = [200, 400, 800]
const SAVE_FAILED = "Couldn't save your change"

const api = (): Window['api']['annotations'] => window.api.annotations
const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((i) => [i.id, i]))
const without = <T>(rec: Record<string, T>, ids: string[]): Record<string, T> => {
  const next = { ...rec }
  for (const id of ids) delete next[id]
  return next
}

/**
 * Runs an IPC write, retrying 3× with backoff; if it still fails, undoes the optimistic change
 * and tells the user. Every caller has already applied its change locally.
 */
async function persist(op: () => Promise<unknown>, rollback: () => void): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await op()
      return
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.error('Annotation save failed', err)
        rollback()
        useToastStore.getState().show(SAVE_FAILED)
        return
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
}

let generation = 0 // invalidates selectPage's cache when a book is (re)loaded or cleared

export const useAnnotationStore = create<AnnotationState>((set, get) => {
  /** Applies a state change and bumps the revision of every page it touches. */
  const apply = (pages: number[], patch: (s: AnnotationState) => Partial<AnnotationState>): void =>
    set((s) => {
      const revision = { ...s.revision }
      for (const p of new Set(pages)) revision[p] = (revision[p] ?? 0) + 1
      return { ...patch(s), revision }
    })

  return {
    bookId: null,
    highlights: {},
    notes: {},
    ink: {},
    bookmarks: {},
    revision: {},

    load: async (bookId) => {
      const token = ++generation
      const a = await api().listForBook(bookId)
      if (token !== generation) return // superseded by clear() or another load
      generation++
      set({
        bookId,
        highlights: byId(a.highlights),
        notes: byId(a.notes),
        ink: byId(a.ink),
        bookmarks: Object.fromEntries(a.bookmarks.map((b) => [b.page, b])),
        revision: {}
      })
    },

    clear: () => {
      generation++
      set({ bookId: null, highlights: {}, notes: {}, ink: {}, bookmarks: {}, revision: {} })
    },

    addHighlights: (hs) => {
      const bookId = get().bookId
      if (!bookId) return []
      const now = Date.now()
      const created = hs.map((h): Highlight => ({
        ...h,
        style: h.style ?? 'highlight',
        id: crypto.randomUUID(),
        bookId,
        noteId: null,
        createdAt: now,
        updatedAt: now
      }))
      apply(
        created.map((h) => h.page),
        (s) => ({ highlights: { ...s.highlights, ...byId(created) } })
      )
      for (const h of created) {
        void persist(
          () => api().upsertHighlight(h),
          () => apply([h.page], (s) => ({ highlights: without(s.highlights, [h.id]) }))
        )
      }
      return created
    },

    setHighlightColor: (id, color) => {
      const prev = get().highlights[id]
      if (!prev || prev.color === color) return
      const next = { ...prev, color, updatedAt: Date.now() }
      apply([prev.page], (s) => ({ highlights: { ...s.highlights, [id]: next } }))
      void persist(
        () => api().upsertHighlight(next),
        () => apply([prev.page], (s) => ({ highlights: { ...s.highlights, [id]: prev } }))
      )
    },

    deleteHighlight: (id) => {
      const h = get().highlights[id]
      if (!h) return
      const note = h.noteId ? get().notes[h.noteId] : undefined
      apply([h.page], (s) => ({
        highlights: without(s.highlights, [id]),
        notes: note ? without(s.notes, [note.id]) : s.notes
      }))
      void persist(
        () => api().deleteHighlight(id),
        () =>
          apply([h.page], (s) => ({
            highlights: { ...s.highlights, [id]: h },
            notes: note ? { ...s.notes, [note.id]: note } : s.notes
          }))
      )
    },

    saveNote: (input) => {
      const s0 = get()
      const prev = input.id ? s0.notes[input.id] : undefined
      const now = Date.now()
      const note: Note = {
        id: input.id ?? crypto.randomUUID(),
        bookId: s0.bookId ?? '',
        page: input.page,
        anchor: input.anchor,
        body: input.body,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now
      }
      const hlId = note.anchor.highlightId
      const hlPrev = hlId ? s0.highlights[hlId] : undefined
      const linkHighlight = (
        s: AnnotationState,
        h: Highlight | undefined
      ): AnnotationState['highlights'] =>
        h && hlId ? { ...s.highlights, [hlId]: h } : s.highlights
      apply([note.page], (s) => ({
        notes: { ...s.notes, [note.id]: note },
        highlights: linkHighlight(s, hlPrev && { ...hlPrev, noteId: note.id })
      }))
      if (s0.bookId) {
        void persist(
          () => api().upsertNote(note),
          () =>
            apply([note.page], (s) => ({
              notes: prev ? { ...s.notes, [note.id]: prev } : without(s.notes, [note.id]),
              highlights: linkHighlight(s, hlPrev)
            }))
        )
      }
      return note
    },

    deleteNote: (id) => {
      const note = get().notes[id]
      if (!note) return
      const hlId = note.anchor.highlightId
      const hl = hlId ? get().highlights[hlId] : undefined
      const setHighlight = (
        s: AnnotationState,
        h: Highlight | undefined
      ): AnnotationState['highlights'] =>
        h && hlId ? { ...s.highlights, [hlId]: h } : s.highlights
      apply([note.page], (s) => ({
        notes: without(s.notes, [id]),
        highlights: setHighlight(s, hl && { ...hl, noteId: null })
      }))
      void persist(
        () => api().deleteNote(id),
        () =>
          apply([note.page], (s) => ({
            notes: { ...s.notes, [id]: note },
            highlights: setHighlight(s, hl)
          }))
      )
    },

    addInk: (strokes) => {
      const bookId = get().bookId
      if (!bookId || strokes.length === 0) return []
      const now = Date.now()
      const created = strokes.map((st, i): InkStroke => ({
        ...st,
        id: crypto.randomUUID(),
        bookId,
        createdAt: now + i
      }))
      get().restoreInk(created)
      return created
    },

    restoreInk: (strokes) => {
      if (strokes.length === 0) return
      const pages = strokes.map((st) => st.page)
      const ids = strokes.map((st) => st.id)
      apply(pages, (s) => ({ ink: { ...s.ink, ...byId(strokes) } }))
      void persist(
        () => api().addInk(strokes),
        () => apply(pages, (s) => ({ ink: without(s.ink, ids) }))
      )
    },

    removeInk: (ids) => {
      const removed = ids.map((id) => get().ink[id]).filter((st): st is InkStroke => !!st)
      if (removed.length === 0) return
      const pages = removed.map((st) => st.page)
      apply(pages, (s) => ({ ink: without(s.ink, ids) }))
      void persist(
        () => api().deleteInk(removed.map((st) => st.id)),
        () => apply(pages, (s) => ({ ink: { ...s.ink, ...byId(removed) } }))
      )
    },

    toggleBookmark: (page) => {
      const bookId = get().bookId
      if (!bookId) return
      const prev = get().bookmarks[page]
      const next: Bookmark | undefined = prev
        ? undefined
        : { id: crypto.randomUUID(), bookId, page, label: null, createdAt: Date.now() }
      const put =
        (b: Bookmark | undefined) =>
        (s: AnnotationState): Partial<AnnotationState> => {
          const bookmarks = { ...s.bookmarks }
          if (b) bookmarks[page] = b
          else delete bookmarks[page]
          return { bookmarks }
        }
      apply([page], put(next))
      void persist(
        () => api().toggleBookmark(bookId, page, null, next?.id),
        () => apply([page], put(prev))
      )
    },

    renameBookmark: (page, label) => {
      const prev = get().bookmarks[page]
      if (!prev) return
      const set1 = (b: Bookmark) => (s: AnnotationState) => ({
        bookmarks: { ...s.bookmarks, [page]: b }
      })
      apply([page], set1({ ...prev, label }))
      void persist(
        () => api().renameBookmark(prev.id, label),
        () => apply([page], set1(prev))
      )
    }
  }
})

const pageCache = new Map<number, { gen: number; rev: number; value: PageAnnotations }>()

/** Annotations on one page; the same object is returned until that page changes. */
export function selectPage(s: AnnotationState, page: number): PageAnnotations {
  const rev = s.revision[page] ?? 0
  const hit = pageCache.get(page)
  if (hit && hit.gen === generation && hit.rev === rev) return hit.value
  const byTime = <T extends { createdAt: number }>(a: T, b: T): number => a.createdAt - b.createdAt
  const value: PageAnnotations = {
    highlights: Object.values(s.highlights)
      .filter((h) => h.page === page)
      .sort(byTime),
    freeNotes: Object.values(s.notes)
      .filter((n) => n.page === page && !n.anchor.highlightId)
      .sort(byTime),
    ink: Object.values(s.ink)
      .filter((st) => st.page === page)
      .sort(byTime),
    bookmark: s.bookmarks[page] ?? null
  }
  pageCache.set(page, { gen: generation, rev, value })
  return value
}
