// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { Note } from '@shared/types'
import { NotePopover } from '@renderer/reader/annotations/NotePopover'

const note: Note = {
  id: 'n1',
  bookId: 'b',
  page: 2,
  anchor: { point: { x: 0.5, y: 0.5 } },
  body: 'existing',
  createdAt: 1,
  updatedAt: 1
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Note' })

describe('NotePopover', () => {
  it('saves 500 ms after the last keystroke, once', () => {
    const onSave = vi.fn()
    render(<NotePopover note={null} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'a' } })
    fireEvent.change(box(), { target: { value: 'ab' } })
    act(() => void vi.advanceTimersByTime(499))
    expect(onSave).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('ab')
  })

  it('saves on blur after a change', () => {
    const onSave = vi.fn()
    render(<NotePopover note={note} onSave={onSave} onClose={vi.fn()} />)
    expect(box().value).toBe('existing')
    fireEvent.change(box(), { target: { value: 'edited' } })
    fireEvent.blur(box())
    expect(onSave).toHaveBeenCalledWith('edited')
    act(() => void vi.advanceTimersByTime(1000))
    expect(onSave).toHaveBeenCalledOnce() // the pending debounce was flushed, not repeated
  })

  it('closing an untouched new note saves nothing', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<NotePopover note={null} onSave={onSave} onClose={onClose} />)
    fireEvent.blur(box())
    fireEvent.keyDown(box(), { key: 'Escape' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Delete calls onDelete', () => {
    const onDelete = vi.fn()
    render(<NotePopover note={note} onSave={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
