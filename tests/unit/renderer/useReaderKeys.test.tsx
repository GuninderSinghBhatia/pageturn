// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import type { OpenedDoc } from '@renderer/reader/pdf/pdfService'
import { useReaderKeys } from '@renderer/reader/useReaderKeys'
import { useReaderStore } from '@renderer/stores/readerStore'

const handlers = {
  onFind: vi.fn(),
  onFocusPageBox: vi.fn(),
  onEscape: vi.fn(),
  onHighlight: vi.fn(() => true),
  onBookmark: vi.fn(),
  onTogglePen: vi.fn(),
  onEraser: vi.fn(),
  onUndo: vi.fn(() => true),
  onRedo: vi.fn(() => true)
}
const store = { requestTurn: vi.fn(), goTo: vi.fn(), setZoom: vi.fn() }

function Harness(): React.JSX.Element {
  useReaderKeys(handlers)
  return <textarea aria-label="Note" />
}

beforeEach(() => {
  Object.values(handlers).forEach((h) => h.mockClear())
  Object.values(store).forEach((h) => h.mockClear())
  useReaderStore.setState({
    doc: { numPages: 100 } as unknown as OpenedDoc,
    zoom: 1,
    ...store
  })
})
afterEach(cleanup)

const called = (): number =>
  [...Object.values(handlers), ...Object.values(store)].reduce((n, f) => n + f.mock.calls.length, 0)

describe('useReaderKeys', () => {
  it('Ctrl+D toggles a bookmark and H highlights (from the page)', () => {
    render(<Harness />)
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'h' })
    expect(handlers.onBookmark).toHaveBeenCalledOnce()
    expect(handlers.onHighlight).toHaveBeenCalledOnce()
  })

  it('ignores reader shortcuts while typing in a textarea (Review Focus 1)', () => {
    const { getByRole } = render(<Harness />)
    const box = getByRole('textbox', { name: 'Note' })
    for (const init of [
      { key: 'ArrowRight' },
      { key: 'h' },
      { key: 'p' },
      { key: 'e' },
      { key: 'Home' },
      { key: 'd', ctrlKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'y', ctrlKey: true },
      { key: '=', ctrlKey: true },
      { key: '0', ctrlKey: true }
    ]) {
      fireEvent.keyDown(box, init)
    }
    expect(called()).toBe(0)
  })
})
