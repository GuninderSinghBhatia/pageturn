import { describe, it, expect } from 'vitest'
import type { InkStroke } from '@shared/types'
import { InkHistory, type InkOp } from '@renderer/reader/ink/history'

let clock = 0
const op = (kind: InkOp['kind'], page: number): InkOp => ({
  kind,
  page,
  strokes: [{ id: `${kind}-${page}-${clock}` } as InkStroke],
  at: ++clock
})

describe('InkHistory', () => {
  it('undoes the newest op among the visible pages first', () => {
    const h = new InkHistory()
    const a = op('add', 2)
    const b = op('add', 3)
    h.push(a)
    h.push(b)
    expect(h.undo([2, 3])).toBe(b)
    expect(h.undo([2, 3])).toBe(a)
    expect(h.undo([2, 3])).toBeNull()
  })

  it('never touches pages that are not visible', () => {
    const h = new InkHistory()
    h.push(op('add', 2))
    expect(h.undo([4, 5])).toBeNull()
    expect(h.redo([4, 5])).toBeNull()
  })

  it('a new op on a page clears that page’s redo stack', () => {
    const h = new InkHistory()
    h.push(op('add', 2))
    h.undo([2])
    h.push(op('erase', 2))
    expect(h.redo([2])).toBeNull()
  })

  it('redo replays in reverse undo order', () => {
    const h = new InkHistory()
    const a = op('add', 2)
    const b = op('erase', 2)
    h.push(a)
    h.push(b)
    h.undo([2])
    h.undo([2])
    expect(h.redo([2])).toBe(a)
    expect(h.redo([2])).toBe(b)
  })

  it('clear forgets everything', () => {
    const h = new InkHistory()
    h.push(op('add', 2))
    h.clear()
    expect(h.undo([2])).toBeNull()
  })
})
