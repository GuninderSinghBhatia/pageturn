import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@renderer/reader/pdf/pdfService', () => ({
  openPdf: vi.fn(),
  PasswordCancelledError: class extends Error {}
}))

import { useReaderStore } from '@renderer/stores/readerStore'
import { openPdf } from '@renderer/reader/pdf/pdfService'
import type { OpenedDoc } from '@renderer/reader/pdf/pdfService'

const saveProgress = vi.fn(async () => {})
const bookId = 'a'.repeat(64)

beforeEach(() => {
  vi.useFakeTimers()
  saveProgress.mockClear()
  ;(globalThis as unknown as { window: unknown }).window = { api: { reader: { saveProgress } } }
  useReaderStore.setState({
    doc: { numPages: 500, destroy: vi.fn() } as unknown as OpenedDoc,
    bookId,
    page: 1,
    layout: 'spread',
    zoom: 1,
    turning: false
  })
})
afterEach(() => vi.useRealTimers())

describe('readerStore navigation', () => {
  it('goTo clamps to the last page (snapped to its spread)', () => {
    useReaderStore.getState().goTo(9999)
    expect(useReaderStore.getState().page).toBe(500)
    useReaderStore.getState().goTo(-3)
    expect(useReaderStore.getState().page).toBe(1)
  })

  it('goTo snaps to the spread start', () => {
    useReaderStore.getState().goTo(7)
    expect(useReaderStore.getState().page).toBe(6)
  })

  it('next() at the end is a no-op; prev() at the start is a no-op', () => {
    useReaderStore.getState().goTo(500)
    useReaderStore.getState().next()
    expect(useReaderStore.getState().page).toBe(500)
    useReaderStore.getState().goTo(1)
    useReaderStore.getState().prev()
    expect(useReaderStore.getState().page).toBe(1)
  })

  it('next/prev step by spreads', () => {
    const s = useReaderStore.getState()
    s.next()
    s.next()
    expect(useReaderStore.getState().page).toBe(4)
    s.prev()
    expect(useReaderStore.getState().page).toBe(2)
  })

  it('saves progress once, 500 ms after rapid goTo calls', () => {
    const s = useReaderStore.getState()
    s.goTo(10)
    s.goTo(20)
    s.goTo(30)
    expect(saveProgress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(499)
    expect(saveProgress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(saveProgress).toHaveBeenCalledOnce()
    expect(saveProgress).toHaveBeenCalledWith(bookId, 30)
  })

  it('setZoom clamps to 1..4: the book never shrinks below its fitted size', () => {
    useReaderStore.getState().setZoom(10)
    expect(useReaderStore.getState().zoom).toBe(4)
    useReaderStore.getState().setZoom(0.8)
    expect(useReaderStore.getState().zoom).toBe(1)
  })

  it('open(bookId, page) starts at that page instead of the saved one', async () => {
    vi.useRealTimers()
    const doc = { numPages: 200, destroy: vi.fn(), pageSize: () => ({ width: 1, height: 1 }) }
    vi.mocked(openPdf).mockResolvedValue(doc as unknown as OpenedDoc)
    ;(globalThis as unknown as { window: unknown }).window = {
      api: {
        reader: { saveProgress },
        library: {
          list: vi.fn(async () => [{ id: bookId, lastPage: 10, numPages: 200 }]),
          getFile: vi.fn(async () => new ArrayBuffer(8)),
          updateMeta: vi.fn(async () => {})
        }
      }
    }
    await useReaderStore.getState().open(bookId, 41)
    expect(useReaderStore.getState().page).toBe(40) // spread start of page 41
    await useReaderStore.getState().open(bookId)
    expect(useReaderStore.getState().page).toBe(10)
  })
})
