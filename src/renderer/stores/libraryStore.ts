import { create } from 'zustand'
import type { Book } from '@shared/types'
import { useNav } from '../app/nav'
import { generateThumbnail } from '../library/thumbnails'

type LibraryState = {
  books: Book[]
  refresh(): Promise<void>
  importPaths(paths: string[]): Promise<Book[]>
  openBook(id: string): void
  /** Heart on the card; optimistic, reverted if saving fails. */
  setLiked(id: string, liked: boolean): void
}

const attempted = new Set<string>() // books we already tried to thumbnail this session

/** Generates covers (and reads PDF metadata) one book at a time, in the background. */
async function fillThumbnails(books: Book[]): Promise<void> {
  for (const b of books) {
    if (b.thumbnailUrl || b.missing || attempted.has(b.id)) continue
    attempted.add(b.id)
    try {
      await generateThumbnail(b)
    } catch (err) {
      console.warn('Thumbnail failed', b.id, err)
    }
  }
}

let filling: Promise<void> | null = null

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  refresh: async () => {
    const books = await window.api.library.list()
    set({ books })
    if (!filling && books.some((b) => !b.thumbnailUrl && !b.missing && !attempted.has(b.id))) {
      filling = fillThumbnails(books).finally(() => {
        filling = null
        void get().refresh()
      })
    }
  },
  importPaths: async (paths) => {
    const pdfs = paths.filter((p) => /\.pdf$/i.test(p))
    if (pdfs.length === 0) return []
    const books = await window.api.library.import(pdfs)
    await get().refresh()
    return books
  },
  openBook: (id) => useNav.getState().goReader(id),
  setLiked: (id, liked) => {
    const put = (v: boolean): void =>
      set({ books: get().books.map((b) => (b.id === id ? { ...b, liked: v } : b)) })
    put(liked)
    window.api.library.setLiked(id, liked).catch(() => put(!liked))
  }
}))
