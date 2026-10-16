import { z } from 'zod'
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  INK_WIDTHS,
  type Book,
  type BookAnnotations,
  type Bookmark,
  type Highlight,
  type InkStroke,
  type Note,
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
  libraryOpenRequest: 'library:openRequest', // event: main → renderer
  libraryChanged: 'library:changed', // event: main → renderer (import/remove/relocate)
  readerSaveProgress: 'reader:saveProgress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  annotationsList: 'annotations:list',
  annotationsUpsertHighlight: 'annotations:upsertHighlight',
  annotationsDeleteHighlight: 'annotations:deleteHighlight',
  annotationsUpsertNote: 'annotations:upsertNote',
  annotationsDeleteNote: 'annotations:deleteNote',
  annotationsAddInk: 'annotations:addInk',
  annotationsDeleteInk: 'annotations:deleteInk',
  annotationsToggleBookmark: 'annotations:toggleBookmark'
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
    penWidth: z.union(INK_WIDTHS.map((w) => z.literal(w)))
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
export const BookmarkLabelSchema = z.string().max(200).nullable().optional()

// ---- Request/response types ----

export type BookMeta = z.infer<typeof BookMetaSchema>
export type SettingsPartial = Partial<Settings>

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
  }
  annotations: {
    listForBook(bookId: string): Promise<BookAnnotations>
    upsertHighlight(h: Highlight): Promise<void>
    deleteHighlight(id: string): Promise<void>
    upsertNote(n: Note): Promise<void>
    deleteNote(id: string): Promise<void>
    addInk(strokes: InkStroke[]): Promise<void>
    deleteInk(ids: string[]): Promise<void>
    /** Adds a bookmark on the page or removes the existing one (null). */
    toggleBookmark(
      bookId: string,
      page: number,
      label?: string | null,
      id?: string
    ): Promise<Bookmark | null>
  }
}
