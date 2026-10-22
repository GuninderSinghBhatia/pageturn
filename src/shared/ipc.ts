import { z } from 'zod'
import {
  HELP_TABS,
  PROVIDERS,
  SEARCH_ENGINES,
  type AiError,
  type ExplainRequest,
  type ProviderId
} from './ai'
import { LANGUAGE_RE, LOOKUP_SITES } from './lookup'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  INK_COLORS,
  INK_WIDTHS,
  NOTE_TAGS,
  type Book,
  type BookAnnotations,
  type Bookmark,
  type Highlight,
  type InkStroke,
  type Note,
  type NoteTag,
  type Settings
} from './types'

/** IPC channel names: one per Api method (plus main → renderer events). */
export const Channels = {
  libraryList: 'library:list',
  libraryImport: 'library:import',
  libraryOpenDialog: 'library:openDialog',
  libraryRemove: 'library:remove',
  libraryRelocate: 'library:relocate',
  libraryGetFile: 'library:getFile',
  librarySaveThumbnail: 'library:saveThumbnail',
  libraryUpdateMeta: 'library:updateMeta',
  librarySetLiked: 'library:setLiked',
  libraryOpenRequest: 'library:openRequest', // event: main → renderer
  libraryChanged: 'library:changed', // event: main → renderer (import/remove/relocate)
  readerSaveProgress: 'reader:saveProgress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:setApiKey',
  settingsHasApiKey: 'settings:hasApiKey',
  settingsClearApiKey: 'settings:clearApiKey',
  aiTestKey: 'ai:testKey',
  aiExplain: 'ai:explain',
  aiFollowUp: 'ai:followUp',
  aiCancel: 'ai:cancel',
  aiToken: 'ai:token',
  aiDone: 'ai:done',
  aiError: 'ai:error',
  appSetUnsaved: 'app:setUnsaved',
  appVersion: 'app:version',
  appCheckForUpdates: 'app:checkForUpdates',
  appInstallUpdate: 'app:installUpdate',
  appOpenLogs: 'app:openLogs',
  updateAvailable: 'update:available',
  updateDownloaded: 'update:downloaded',
  appReportError: 'app:reportError',
  exportMarkdown: 'export:markdown',
  exportMarkdownText: 'export:markdownText',
  exportBackup: 'export:backup',
  exportImportBackup: 'export:importBackup',
  exportOpenDataFolder: 'export:openDataFolder',
  webShow: 'web:show',
  webReveal: 'web:reveal',
  webSetBounds: 'web:setBounds',
  webHide: 'web:hide',
  webBack: 'web:back',
  webForward: 'web:forward',
  webReload: 'web:reload',
  webOpenExternal: 'web:openExternal',
  webState: 'web:state',
  annotationsList: 'annotations:list',
  annotationsUpsertHighlight: 'annotations:upsertHighlight',
  annotationsDeleteHighlight: 'annotations:deleteHighlight',
  annotationsUpsertNote: 'annotations:upsertNote',
  annotationsDeleteNote: 'annotations:deleteNote',
  annotationsSetNoteTags: 'annotations:setNoteTags',
  annotationsAddInk: 'annotations:addInk',
  annotationsDeleteInk: 'annotations:deleteInk',
  annotationsToggleBookmark: 'annotations:toggleBookmark',
  annotationsRenameBookmark: 'annotations:renameBookmark',
  annotationsListAllNotes: 'annotations:listAllNotes',
  windowFitAspect: 'window:fitAspect',
  windowControl: 'window:control',
  windowGetState: 'window:getState',
  windowState: 'window:state',
  lookupWikipedia: 'lookup:wikipedia',
  lookupOpen: 'lookup:open'
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

// ---- Payload schemas (validated in main before use) ----

export const BookIdSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const PageSchema = z.number().int().min(1)
export const PathsSchema = z.array(z.string().regex(/\.pdf$/i)).nonempty()

export const SettingsPartialSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    paperTint: z.enum(['white', 'cream', 'sepia', 'dark']),
    pageTurnStyle: z.enum(['curl', 'slide', 'instant']),
    layout: z.enum(['auto', 'spread', 'single']),
    turnSound: z.boolean(),
    highlightColor: z.enum(HIGHLIGHT_COLORS),
    drawWithMouse: z.boolean(),
    penColor: z.enum(INK_COLORS),
    penWidth: z.union(INK_WIDTHS.map((w) => z.literal(w))),
    showBookmarkTabs: z.boolean(),
    lookupSite: z.enum(LOOKUP_SITES),
    lookupLanguage: z.string().regex(LANGUAGE_RE),
    lookupCustomUrl: z.string().max(500),
    lookupOpenIn: z.enum(['app', 'browser']),
    aiProvider: z.enum(PROVIDERS),
    aiModel: z.string().trim().min(1).max(120).nullable(),
    searchEngine: z.enum(SEARCH_ENGINES),
    searchIncludeTitle: z.boolean(),
    helpDefaultTab: z.enum(HELP_TABS),
    helpPanelWidth: z.number().int().min(320).max(4000),
    aiPrivacyAcknowledged: z.boolean(),
    onboardingDone: z.boolean()
  })
  .partial()
  .strict()

export const BookMetaSchema = z.object({
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  numPages: z.number().int().min(1)
})

export const PngSchema = z.instanceof(ArrayBuffer)

// ---- Annotations ----

export const IdSchema = z.uuid()
const TimeSchema = z.number().int().nonnegative()
const Unit = z.number().min(-0.05).max(1.05) // normalized page coordinate (small overshoot allowed)

export const RectSchema = z.object({
  x: Unit,
  y: Unit,
  w: z.number().min(0).max(1.1),
  h: z.number().min(0).max(1.1)
})

export const HighlightSchema = z
  .object({
    id: IdSchema,
    bookId: BookIdSchema,
    page: PageSchema,
    rects: z.array(RectSchema).min(1).max(500),
    text: z.string().max(20_000),
    color: z.enum(HIGHLIGHT_COLORS),
    style: z.enum(HIGHLIGHT_STYLES),
    noteId: IdSchema.nullable(),
    createdAt: TimeSchema,
    updatedAt: TimeSchema
  })
  .strict()

export const NoteSchema = z
  .object({
    id: IdSchema,
    bookId: BookIdSchema,
    page: PageSchema,
    anchor: z
      .object({
        highlightId: IdSchema.optional(),
        point: z.object({ x: Unit, y: Unit }).optional()
      })
      .strict(),
    body: z.string().max(100_000),
    tags: z.array(z.enum(NOTE_TAGS)).max(3).optional(),
    createdAt: TimeSchema,
    updatedAt: TimeSchema
  })
  .strict()

export const InkStrokeSchema = z
  .object({
    id: IdSchema,
    bookId: BookIdSchema,
    page: PageSchema,
    points: z
      .array(z.tuple([Unit, Unit, z.number().min(0).max(1)]))
      .min(1)
      .max(20_000),
    color: z.enum(INK_COLORS),
    width: z.number().positive().max(0.1),
    tool: z.enum(['pen', 'highlighter']),
    createdAt: TimeSchema
  })
  .strict()

export const InkStrokesSchema = z.array(InkStrokeSchema).min(1).max(500)
export const InkIdsSchema = z.array(IdSchema).min(1).max(500)
/** Book width / height for the window to match; 0 releases the lock. */
export const WindowAspectSchema = z.union([z.literal(0), z.number().min(0.3).max(4)])

/** The full tag set for a note (duplicates removed by the repo). */
export const NoteTagsSchema = z.array(z.enum(NOTE_TAGS)).max(3)

/** Phrase to look up and the Wikipedia language to look it up in. */
export const LookupQuerySchema = z.string().trim().min(1).max(300)
export const LookupLanguageSchema = z.string().regex(LANGUAGE_RE)
/** Only web addresses may be opened from a look-up. */
export const LookupUrlSchema = z
  .string()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'http(s) only')
export const LookupOpenInSchema = z.enum(['app', 'browser'])

/** The app's own minimise / maximise / close buttons (the OS title bar is hidden). */
export const WindowControlSchema = z.enum(['minimize', 'toggleMaximize', 'close'])

export const BookmarkLabelSchema = z.string().max(200).nullable().optional()

// ---- Request/response types ----

export type BookMeta = z.infer<typeof BookMetaSchema>
export type SettingsPartial = Partial<Settings>
export type WindowControl = z.infer<typeof WindowControlSchema>
export type WindowState = { maximized: boolean; fullscreen: boolean }
/** A Wikipedia article summary for the Look up card. */
export type WikiSummary = {
  title: string
  description: string | null
  extract: string
  thumbnail: string | null // data: URL (the page CSP allows no remote images)
  url: string
}
export type WebBounds = { x: number; y: number; width: number; height: number }
export type WebState = {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  error: string | null
}
export type NotesGroup = { book: Book; notes: { note: Note; quote: string | null }[] }

export interface Api {
  library: {
    list(): Promise<Book[]>
    import(paths: string[]): Promise<Book[]>
    openDialog(): Promise<Book[]>
    /** Hides the book (annotations kept for a later re-import) unless deleteAnnotations. */
    remove(bookId: string, deleteAnnotations: boolean): Promise<void>
    relocate(bookId: string): Promise<Book | null>
    getFile(bookId: string): Promise<ArrayBuffer>
    saveThumbnail(bookId: string, png: ArrayBuffer): Promise<string>
    updateMeta(bookId: string, meta: BookMeta): Promise<void>
    setLiked(bookId: string, liked: boolean): Promise<void>
    onOpenRequest(cb: (book: Book) => void): () => void
    onChanged(cb: () => void): () => void
    /** Absolute path of a dropped File (Electron webUtils). */
    pathForFile(file: File): string
  }
  reader: {
    saveProgress(bookId: string, page: number): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(partial: SettingsPartial): Promise<Settings>
    /** Stores the key encrypted in main; the renderer can only ask whether one exists. */
    setApiKey(p: ProviderId, key: string): Promise<void>
    hasApiKey(p: ProviderId): Promise<boolean>
    clearApiKey(p: ProviderId): Promise<void>
  }
  ai: {
    testKey(p: ProviderId): Promise<{ ok: true } | { ok: false; error: AiError }>
    /** Starts streaming an explanation; results arrive through onToken / onDone / onError. */
    explain(requestId: string, req: ExplainRequest): Promise<void>
    followUp(requestId: string, text: string): Promise<void>
    cancel(requestId: string): Promise<void>
    onToken(cb: (e: { requestId: string; token: string }) => void): () => void
    onDone(cb: (e: { requestId: string; text: string }) => void): () => void
    onError(cb: (e: { requestId: string; error: AiError }) => void): () => void
  }
  annotations: {
    listForBook(bookId: string): Promise<BookAnnotations>
    upsertHighlight(h: Highlight): Promise<void>
    deleteHighlight(id: string): Promise<void>
    upsertNote(n: Note): Promise<void>
    deleteNote(id: string): Promise<void>
    setNoteTags(id: string, tags: NoteTag[]): Promise<void>
    addInk(strokes: InkStroke[]): Promise<void>
    deleteInk(ids: string[]): Promise<void>
    /** Adds a bookmark on the page or removes the existing one (null). */
    toggleBookmark(
      bookId: string,
      page: number,
      label?: string | null,
      id?: string
    ): Promise<Bookmark | null>
    renameBookmark(id: string, label: string | null): Promise<void>
    /** Notes across the whole library, grouped by book (newest activity first). */
    listAllNotes(): Promise<NotesGroup[]>
  }
  app: {
    /** How many changes failed to save; quitting warns while this is above 0. */
    setUnsaved(count: number): Promise<void>
    /** Logs a renderer error to userData/logs. */
    reportError(message: string, stack?: string): Promise<void>
    version(): Promise<string>
    /** 'dev' when not packaged (no updates while developing). */
    checkForUpdates(): Promise<
      { status: 'available'; version: string } | { status: 'current' | 'dev' | 'error' }
    >
    /** Restarts into a downloaded update. */
    installUpdate(): Promise<void>
    openLogs(): Promise<void>
    onUpdateDownloaded(cb: (e: { version: string }) => void): () => void
  }
  export: {
    /** Saves the book's notes as Markdown (save dialog; default `{title}-notes.md`). */
    markdown(bookId: string): Promise<{ saved: boolean; path?: string }>
    /** The same Markdown as text ("Copy all"). */
    markdownText(bookId: string): Promise<string>
    /** Saves a JSON backup of the whole library (never includes API keys). */
    backup(): Promise<{ saved: boolean; path?: string }>
    /** Merges a backup file into the library (newer copies win). */
    importBackup(): Promise<{ added: number; updated: number; skipped: number } | { error: string }>
    openDataFolder(): Promise<void>
  }
  web: {
    /** Searches `query` (engine and title option from settings) in the in-app web view. */
    show(query: string, bounds: WebBounds, bookTitle: string | null): Promise<void>
    /** Puts the view back (same page) after it was hidden. */
    reveal(bounds: WebBounds): Promise<void>
    setBounds(bounds: WebBounds): Promise<void>
    hide(): Promise<void>
    back(): Promise<void>
    forward(): Promise<void>
    reload(): Promise<void>
    openExternal(): Promise<void>
    onState(cb: (s: WebState) => void): () => void
  }
  lookup: {
    /** Summary of the best-matching Wikipedia article, or null when there is none. */
    wikipedia(query: string, lang: string): Promise<WikiSummary | null>
    /** Opens a web address in the in-app look-up window or the default browser. */
    open(url: string, where: 'app' | 'browser'): Promise<void>
  }
  window: {
    /** Keeps a normal window in the book's shape (width / height); 0 releases it. */
    fitAspect(aspect: number): Promise<void>
    /** Minimise, maximise / restore (leaves fullscreen first) or close the window. */
    control(action: WindowControl): Promise<void>
    getState(): Promise<WindowState>
    /** Maximized / fullscreen changes; returns an unsubscribe function. */
    onState(cb: (s: WindowState) => void): () => void
    /** The OS, e.g. 'win32' (macOS keeps its own traffic-light buttons). */
    platform: string
  }
}
