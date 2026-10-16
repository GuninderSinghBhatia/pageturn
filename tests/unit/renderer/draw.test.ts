import { describe, it, expect } from 'vitest'
import type { Highlight, InkStroke } from '@shared/types'
import { drawPageAnnotations } from '@renderer/reader/annotations/draw'
import type { PageAnnotations } from '@renderer/stores/annotationStore'

type Call = { op: string; args: unknown[]; composite: string; alpha: number; fill: unknown }

/** Records drawing calls with the context state at the time of each call. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: Call[]; state: () => Call } {
  const calls: Call[] = []
  const st = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '#000' }
  const stack: (typeof st)[] = []
  const rec =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({
        op,
        args,
        composite: st.globalCompositeOperation,
        alpha: st.globalAlpha,
        fill: st.fillStyle
      })
    }
  const ctx = new Proxy(st, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      if (prop === 'save') return () => stack.push({ ...st })
      if (prop === 'restore') return () => Object.assign(st, stack.pop())
      return rec(prop)
    },
    set(target, prop: string, value) {
      ;(target as Record<string, unknown>)[prop] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
  return {
    ctx,
    calls,
    state: () => ({
      op: 'state',
      args: [],
      composite: st.globalCompositeOperation,
      alpha: st.globalAlpha,
      fill: st.fillStyle
    })
  }
}

const hl: Highlight = {
  id: 'h',
  bookId: 'b',
  page: 1,
  rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }],
  text: '',
  color: 'green',
  style: 'highlight',
  noteId: null,
  createdAt: 1,
  updatedAt: 1
}
const ink = (tool: InkStroke['tool'], createdAt: number): InkStroke => ({
  id: tool + createdAt,
  bookId: 'b',
  page: 1,
  points: [
    [0.1, 0.5, 0.5],
    [0.4, 0.5, 0.5]
  ],
  color: '#d0342c',
  width: 0.005,
  tool,
  createdAt
})
const ann = (over: Partial<PageAnnotations> = {}): PageAnnotations => ({
  highlights: [],
  freeNotes: [],
  ink: [],
  bookmark: null,
  ...over
})

describe('drawPageAnnotations', () => {
  it('fills highlight rects in pixels with multiply blend at alpha 0.4', () => {
    const { ctx, calls } = recordingCtx()
    drawPageAnnotations(ctx, ann({ highlights: [hl] }), 400, 600)
    const fill = calls.find((c) => c.op === 'fillRect')!
    expect(fill.args).toEqual([40, 120, 200, 12])
    expect(fill.composite).toBe('multiply')
    expect(fill.alpha).toBeCloseTo(0.4)
    expect(fill.fill).toBe('#7ed87e')
  })

  it('draws pen ink normally and highlighter ink with multiply at 0.35', () => {
    const { ctx, calls } = recordingCtx()
    drawPageAnnotations(ctx, ann({ ink: [ink('pen', 1), ink('highlighter', 2)] }), 400, 600)
    const fills = calls.filter((c) => c.op === 'fill')
    expect(fills).toHaveLength(2)
    expect(fills[0]).toMatchObject({ composite: 'source-over', alpha: 1, fill: '#d0342c' })
    expect(fills[1].composite).toBe('multiply')
    expect(fills[1].alpha).toBeCloseTo(0.35)
  })

  it('draws the live stroke last and leaves the context state as it found it', () => {
    const { ctx, calls, state } = recordingCtx()
    drawPageAnnotations(
      ctx,
      ann({ highlights: [hl], ink: [ink('pen', 1)] }),
      400,
      600,
      ink('pen', 9)
    )
    expect(calls.filter((c) => c.op === 'fill')).toHaveLength(2)
    expect(state()).toMatchObject({ composite: 'source-over', alpha: 1 })
  })

  it('underline styles draw lines under each rect instead of filling it', () => {
    for (const style of ['underline', 'wavy', 'note'] as const) {
      const { ctx, calls } = recordingCtx()
      drawPageAnnotations(ctx, ann({ highlights: [{ ...hl, style }] }), 400, 600)
      expect(calls.find((c) => c.op === 'fillRect')).toBeUndefined()
      const strokes = calls.filter((c) => c.op === 'stroke')
      expect(strokes.length).toBeGreaterThan(0)
      const ys = calls.filter((c) => c.op === 'lineTo').map((c) => c.args[1] as number)
      const bottom = (0.2 + 0.02) * 600
      for (const y of ys) expect(Math.abs(y - bottom)).toBeLessThan(5) // hugs the line's foot
      const dashed = calls.some((c) => c.op === 'setLineDash' && (c.args[0] as number[]).length > 0)
      expect(dashed).toBe(style === 'note')
      const segments = calls.filter((c) => c.op === 'lineTo').length
      if (style === 'wavy') expect(segments).toBeGreaterThan(8)
      else expect(segments).toBe(1)
    }
  })
})
