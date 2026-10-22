import {
  HIGHLIGHT_COLORS,
  type Bookmark,
  type Highlight,
  type InkStroke,
  type Note
} from '@shared/types'

export type NotebookKind = 'highlight' | 'note' | 'bookmark' | 'ink'
export type NotebookItem = {
  kind: NotebookKind
  id: string
  page: number
  color?: Highlight['color']
  text: string
  noteText?: string
  createdAt: number
}
export type NotebookFilter = {
  query: string
  kinds: Set<NotebookKind>
  colors: Set<Highlight['color']>
  groupBy: 'page' | 'color'
}

type StoreShape = {
  highlights: Record<string, Highlight>
  notes: Record<string, Note>
  bookmarks: Record<number, Bookmark>
  ink: Record<string, InkStroke>
}

/** Everything in the annotation store as notebook rows (ink: one row per page). */
export function toItems(store: StoreShape): NotebookItem[] {
  const highlights = Object.values(store.highlights)
  const attached = new Set<string>()
  for (const h of highlights) if (h.noteId) attached.add(h.noteId)
  for (const n of Object.values(store.notes)) if (n.anchor.highlightId) attached.add(n.id)

  const items: NotebookItem[] = highlights.map((h) => {
    const note =
      (h.noteId && store.notes[h.noteId]) ||
      Object.values(store.notes).find((n) => n.anchor.highlightId === h.id)
    return {
      kind: 'highlight',
      id: h.id,
      page: h.page,
      color: h.color,
      text: h.text,
      noteText: note && note.body.trim() ? note.body : undefined,
      createdAt: h.createdAt
    }
  })
  for (const n of Object.values(store.notes)) {
    if (attached.has(n.id) || !n.body.trim()) continue
    items.push({ kind: 'note', id: n.id, page: n.page, text: n.body, createdAt: n.createdAt })
  }
  for (const b of Object.values(store.bookmarks)) {
    items.push({
      kind: 'bookmark',
      id: b.id,
      page: b.page,
      text: b.label || 'Bookmark',
      createdAt: b.createdAt
    })
  }
  const inkPages = new Map<number, number>()
  for (const s of Object.values(store.ink)) {
    inkPages.set(s.page, Math.min(inkPages.get(s.page) ?? Infinity, s.createdAt ?? 0))
  }
  for (const [page, createdAt] of inkPages) {
    items.push({ kind: 'ink', id: `ink-${page}`, page, text: 'Handwritten notes', createdAt })
  }
  return items.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
}

export function filterItems(items: NotebookItem[], f: NotebookFilter): NotebookItem[] {
  const q = f.query.trim().toLowerCase()
  return items.filter(
    (i) =>
      (f.kinds.size === 0 || f.kinds.has(i.kind)) &&
      (f.colors.size === 0 || (i.color !== undefined && f.colors.has(i.color))) &&
      (!q || i.text.toLowerCase().includes(q) || (i.noteText ?? '').toLowerCase().includes(q))
  )
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Groups by page ("Page N", ascending) or by colour (fixed order; other items last). */
export function groupItems(
  items: NotebookItem[],
  by: NotebookFilter['groupBy']
): { key: string; items: NotebookItem[] }[] {
  if (by === 'page') {
    const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b)
    return pages.map((p) => ({ key: `Page ${p}`, items: items.filter((i) => i.page === p) }))
  }
  const groups = HIGHLIGHT_COLORS.map((c) => ({
    key: cap(c),
    items: items.filter((i) => i.color === c)
  }))
  const other = items.filter((i) => !i.color)
  return [...groups, { key: 'Notes, bookmarks and ink', items: other }].filter(
    (g) => g.items.length
  )
}
