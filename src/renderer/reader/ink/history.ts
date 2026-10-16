import type { InkStroke } from '@shared/types'

export type InkOp = { kind: 'add' | 'erase'; page: number; strokes: InkStroke[]; at: number }

type Stacks = { undo: InkOp[]; redo: InkOp[] }

/**
 * Ink undo/redo kept per page for the reading session. Undo and redo only ever act on the
 * pages currently on screen, picking the most recent operation among them.
 */
export class InkHistory {
  private pages = new Map<number, Stacks>()

  private stacks(page: number): Stacks {
    let s = this.pages.get(page)
    if (!s) this.pages.set(page, (s = { undo: [], redo: [] }))
    return s
  }

  push(op: InkOp): void {
    const s = this.stacks(op.page)
    s.undo.push(op)
    s.redo = []
  }

  undo(visible: number[]): InkOp | null {
    return this.move(visible, 'undo', 'redo')
  }

  redo(visible: number[]): InkOp | null {
    return this.move(visible, 'redo', 'undo')
  }

  clear(): void {
    this.pages.clear()
  }

  /** Moves the newest op among the visible pages from one stack to the other. */
  private move(visible: number[], from: keyof Stacks, to: keyof Stacks): InkOp | null {
    let best: Stacks | null = null
    for (const p of visible) {
      const s = this.pages.get(p)
      const top = s?.[from].at(-1)
      if (s && top && (!best || top.at > best[from].at(-1)!.at)) best = s
    }
    if (!best) return null
    const op = best[from].pop()!
    best[to].push(op)
    return op
  }
}
