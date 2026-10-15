import { z } from 'zod'
import type { Book, Settings } from './types'

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
  readerSaveProgress: 'reader:saveProgress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
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
    turnSound: z.boolean()
  })
  .partial()
  .strict()

export const BookMetaSchema = z.object({
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  numPages: z.number().int().min(1)
})

export const PngSchema = z.instanceof(ArrayBuffer)

// ---- Request/response types ----

export type BookMeta = z.infer<typeof BookMetaSchema>
export type SettingsPartial = Partial<Settings>

export interface Api {
  library: {
    list(): Promise<Book[]>
    import(paths: string[]): Promise<Book[]>
    openDialog(): Promise<Book[]>
    remove(bookId: string): Promise<void>
    relocate(bookId: string): Promise<Book | null>
    getFile(bookId: string): Promise<ArrayBuffer>
    saveThumbnail(bookId: string, png: ArrayBuffer): Promise<string>
    updateMeta(bookId: string, meta: BookMeta): Promise<void>
    onOpenRequest(cb: (book: Book) => void): () => void
  }
  reader: {
    saveProgress(bookId: string, page: number): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(partial: SettingsPartial): Promise<Settings>
  }
}
