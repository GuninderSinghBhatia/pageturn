import type { Bookmark, Highlight, Note } from '@shared/types'

/** Everything a book's notes export needs (plan: "BookAnnotations", renamed to avoid a clash). */
export type ExportInput = {
  title: string
  highlights: Highlight[]
  notes: Note[]
  inkPages: number[]
  bookmarks: Bookmark[]
}

/** Every line prefixed with "> " so multi-line passages stay one quote. */
export function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n')
}

/** Escapes Markdown block syntax at line starts (#, >, -, +, "1.") so notes render as written. */
export function escapeLineStart(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^(\s*)([#>+-])/, '$1\\$2').replace(/^(\s*)(\d+)\./, '$1$2\\.'))
    .join('\n')
}

/** The book's highlights, notes, bookmarks and ink pages as Markdown, page by page. */
export function renderMarkdown(a: ExportInput): string {
  const notesById = new Map(a.notes.map((n) => [n.id, n]))
  const attached = new Set<string>()
  for (const h of a.highlights) if (h.noteId) attached.add(h.noteId)
  for (const n of a.notes) if (n.anchor.highlightId) attached.add(n.id)

  const pages = new Set<number>([
    ...a.highlights.map((h) => h.page),
    ...a.notes.filter((n) => !attached.has(n.id)).map((n) => n.page),
    ...a.bookmarks.map((b) => b.page),
    ...a.inkPages
  ])
  if (pages.size === 0) return `# ${a.title}\n\n_No highlights or notes yet._\n`

  const blocks: string[] = [`# ${a.title}`]
  for (const page of [...pages].sort((x, y) => x - y)) {
    const parts: string[] = []
    for (const b of a.bookmarks.filter((b) => b.page === page)) {
      parts.push(b.label ? `🔖 Bookmark: ${escapeLineStart(b.label)}` : '🔖 Bookmark')
    }
    const hls = a.highlights
      .filter((h) => h.page === page)
      .sort((x, y) => x.createdAt - y.createdAt)
    for (const h of hls) {
      parts.push(`${quoteBlock(h.text)} — *${h.color}*`)
      const n =
        (h.noteId && notesById.get(h.noteId)) || a.notes.find((x) => x.anchor.highlightId === h.id)
      if (n && n.body.trim()) parts.push(escapeLineStart(n.body.trim()))
    }
    const free = a.notes
      .filter((n) => n.page === page && !attached.has(n.id) && n.body.trim())
      .sort((x, y) => x.createdAt - y.createdAt)
    for (const n of free) parts.push(`📝 ${escapeLineStart(n.body.trim())}`)
    if (a.inkPages.includes(page)) parts.push(`Page ${page} — handwritten notes`)
    if (parts.length) blocks.push(`## Page ${page}`, ...parts)
  }
  return `${blocks.join('\n\n')}\n`
}
