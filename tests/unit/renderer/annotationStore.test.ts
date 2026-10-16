import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BookAnnotations } from '@shared/types'
import { useAnnotationStore, selectPage } from '@renderer/stores/annotationStore'
import { useToastStore } from '@renderer/stores/toastStore'

const bookId = 'a'.repeat(64)
type Fn = ReturnType<typeof vi.fn>
let api: Record<string, Fn>

const empty: BookAnnotations = { highlights: [], notes: [], ink: [], bookmarks: [] }
const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }
const s = (): ReturnType<typeof useAnnotationStore.getState> => useAnnotationStore.getState()

beforeEach(async () => {
  vi.useFakeTimers()
  api = {
    listForBook: vi.fn(async () => empty),
    upsertHighlight: vi.fn(async () => {}),
    deleteHighlight: vi.fn(async () => {}),
    upsertNote: vi.fn(async () => {}),
    deleteNote: vi.fn(async () => {}),
    addInk: vi.fn(async () => {}),
    deleteInk: vi.fn(async () => {}),
    toggleBookmark: vi.fn(async () => null),
    renameBookmark: vi.fn(async () => {})
  }
  ;(globalThis as unknown as { window: unknown }).window = { api: { annotations: api } }
  useToastStore.setState({ toasts: [] })
  s().clear()
  await s().load(bookId)
})
afterEach(() => vi.useRealTimers())

const addOne = (page = 3): string =>
  s().addHighlights([{ page, rects: [rect], text: 'Lorem', color: 'yellow' }])[0].id

describe('annotationStore', () => {
  it('a new highlight shows immediately and bumps its page revision', () => {
    const before = s().revision[3] ?? 0
    const id = addOne()
    expect(selectPage(s(), 3).highlights.map((h) => h.id)).toEqual([id])
    expect(s().revision[3]).toBe(before + 1)
    expect(api.upsertHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ id, bookId, page: 3, noteId: null })
    )
  })

  it('rolls back and toasts after 3 failed retries (Review Focus 3)', async () => {
    api.upsertHighlight.mockRejectedValue(new Error('disk full'))
    addOne()
    const rev = s().revision[3]
    await vi.advanceTimersByTimeAsync(1400)
    expect(api.upsertHighlight).toHaveBeenCalledTimes(4)
    expect(selectPage(s(), 3).highlights).toEqual([])
    expect(s().revision[3]).toBe(rev + 1)
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      "Couldn't save your change"
    ])
  })

  it('keeps the change when a retry succeeds', async () => {
    api.upsertHighlight
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'))
    addOne()
    await vi.advanceTimersByTimeAsync(1400)
    expect(api.upsertHighlight).toHaveBeenCalledTimes(3)
    expect(selectPage(s(), 3).highlights).toHaveLength(1)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('deleting a highlight also removes its note locally', () => {
    const id = addOne()
    const note = s().saveNote({ page: 3, anchor: { highlightId: id }, body: 'why?' })
    expect(s().highlights[id].noteId).toBe(note.id)
    s().deleteHighlight(id)
    expect(s().highlights[id]).toBeUndefined()
    expect(s().notes[note.id]).toBeUndefined()
  })

  it('free notes appear in selectPage().freeNotes; anchored ones do not', () => {
    const id = addOne()
    s().saveNote({ page: 3, anchor: { highlightId: id }, body: 'anchored' })
    const free = s().saveNote({ page: 3, anchor: { point: { x: 0.5, y: 0.5 } }, body: 'free' })
    expect(selectPage(s(), 3).freeNotes.map((n) => n.id)).toEqual([free.id])
  })

  it('saveNote with an id updates the body', () => {
    const n = s().saveNote({ page: 2, anchor: { point: { x: 0.1, y: 0.1 } }, body: 'a' })
    s().saveNote({ id: n.id, page: 2, anchor: n.anchor, body: 'ab' })
    expect(s().notes[n.id].body).toBe('ab')
    expect(s().notes[n.id].createdAt).toBe(n.createdAt)
  })

  it('toggleBookmark twice removes it and calls IPC each time', async () => {
    s().toggleBookmark(4)
    expect(selectPage(s(), 4).bookmark).not.toBeNull()
    s().toggleBookmark(4)
    expect(s().bookmarks[4]).toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.toggleBookmark).toHaveBeenCalledTimes(2)
  })

  it('highlights default to style "highlight" and keep a given style', () => {
    const [plain] = s().addHighlights([{ page: 2, rects: [rect], text: 'a', color: 'blue' }])
    const [wavy] = s().addHighlights([
      { page: 2, rects: [rect], text: 'b', color: 'blue', style: 'wavy' }
    ])
    expect(plain.style).toBe('highlight')
    expect(wavy.style).toBe('wavy')
    expect(api.upsertHighlight).toHaveBeenLastCalledWith(expect.objectContaining({ style: 'wavy' }))
  })

  it('renameBookmark updates the label and persists it', async () => {
    s().toggleBookmark(6)
    const id = s().bookmarks[6].id
    s().renameBookmark(6, 'Key result')
    expect(s().bookmarks[6].label).toBe('Key result')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.renameBookmark).toHaveBeenCalledWith(id, 'Key result')
  })

  it('ink can be removed and restored', () => {
    const [st] = s().addInk([
      { page: 5, points: [[0.1, 0.1, 0.5]], color: '#1f1f1f', width: 0.005, tool: 'pen' }
    ])
    s().removeInk([st.id])
    expect(selectPage(s(), 5).ink).toEqual([])
    s().restoreInk([st])
    expect(selectPage(s(), 5).ink).toEqual([st])
    expect(api.deleteInk).toHaveBeenCalledWith([st.id])
    expect(api.addInk).toHaveBeenLastCalledWith([st])
  })

  it('selectPage returns the same object until the page revision changes', () => {
    const a = selectPage(s(), 3)
    expect(selectPage(s(), 3)).toBe(a)
    addOne(3)
    expect(selectPage(s(), 3)).not.toBe(a)
  })

  it('a load that resolves after clear() is ignored', async () => {
    let resolve!: (a: BookAnnotations) => void
    api.listForBook.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const pending = s().load(bookId)
    s().clear()
    resolve({ ...empty, bookmarks: [{ id: 'b1', bookId, page: 9, label: null, createdAt: 1 }] })
    await pending
    expect(s().bookId).toBeNull()
    expect(s().bookmarks).toEqual({})
  })

  it('load replaces state with the book annotations', async () => {
    api.listForBook.mockResolvedValueOnce({
      ...empty,
      bookmarks: [{ id: 'b1', bookId, page: 9, label: null, createdAt: 1 }]
    })
    await s().load(bookId)
    expect(s().bookmarks[9]).toMatchObject({ id: 'b1' })
    expect(Object.keys(s().highlights)).toEqual([])
  })
})
