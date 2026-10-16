import type { LookupOpenIn, LookupSite } from './lookup'

export type Book = {
  id: string
  path: string
  title: string | null
  author: string | null
  numPages: number | null
  lastPage: number
  addedAt: number
  lastOpenedAt: number | null
  liked: boolean
  missing: boolean
  thumbnailUrl: string | null
}

export type LayoutMode = 'auto' | 'spread' | 'single'
export type PageTurnStyle = 'curl' | 'slide' | 'instant'
export type PaperTint = 'white' | 'cream' | 'sepia' | 'dark'
export type Theme = 'system' | 'light' | 'dark'

// ---- Annotations (all coordinates normalized 0..1 of the page) ----

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** Ink palette and stroke widths (fractions of page width). */
export const INK_COLORS = [
  '#1f1f1f',
  '#d0342c',
  '#2a62c9',
  '#2e8b57',
  '#e07b00',
  '#7b3fb5'
] as const
export const INK_WIDTHS = [0.0025, 0.005, 0.01] as const

export const HIGHLIGHT_STYLES = ['highlight', 'underline', 'wavy', 'note'] as const
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number]

export type Rect = { x: number; y: number; w: number; h: number }

export type Highlight = {
  id: string
  bookId: string
  page: number
  rects: Rect[]
  text: string
  color: HighlightColor
  style: HighlightStyle
  noteId: string | null
  createdAt: number
  updatedAt: number
}

export type Note = {
  id: string
  bookId: string
  page: number
  anchor: { highlightId?: string; point?: { x: number; y: number } }
  body: string // markdown
  createdAt: number
  updatedAt: number
}

export type InkTool = 'pen' | 'highlighter'

export type InkStroke = {
  id: string
  bookId: string
  page: number
  points: [number, number, number][] // x, y, pressure
  color: string
  width: number // fraction of page width
  tool: InkTool
  createdAt: number
}

export type Bookmark = {
  id: string
  bookId: string
  page: number
  label: string | null
  createdAt: number
}

export type BookAnnotations = {
  highlights: Highlight[]
  notes: Note[]
  ink: InkStroke[]
  bookmarks: Bookmark[]
}

export type Settings = {
  theme: Theme
  paperTint: PaperTint
  pageTurnStyle: PageTurnStyle
  layout: LayoutMode
  turnSound: boolean
  highlightColor: HighlightColor // last colour used
  drawWithMouse: boolean
  penColor: string // one of INK_COLORS
  penWidth: number // one of INK_WIDTHS
  showBookmarkTabs: boolean
  lookupSite: LookupSite
  lookupLanguage: string // Wikipedia / Wiktionary language code
  lookupCustomUrl: string // http(s) address with {query}
  lookupOpenIn: LookupOpenIn
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  paperTint: 'cream',
  pageTurnStyle: 'curl',
  layout: 'auto',
  turnSound: false,
  highlightColor: 'yellow',
  drawWithMouse: false,
  penColor: '#1f1f1f',
  penWidth: 0.005,
  showBookmarkTabs: true,
  lookupSite: 'wikipedia',
  lookupLanguage: 'en',
  lookupCustomUrl: '',
  lookupOpenIn: 'app'
}
