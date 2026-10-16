import type { Highlight, HighlightColor, InkStroke, Rect } from '@shared/types'
import type { PageAnnotations } from '../../stores/annotationStore'
import { needsSimulatedPressure, strokeOutline } from '../ink/strokes'

export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  yellow: '#ffd84d',
  green: '#7ed87e',
  blue: '#7fb8ff',
  pink: '#ff9ccf',
  purple: '#c49cff'
}

/** Stronger shades for underline styles (a pale highlight colour would vanish as a thin line). */
const UNDERLINE_HEX: Record<HighlightColor, string> = {
  yellow: '#c99a00',
  green: '#3f9f3f',
  blue: '#3d7fd6',
  pink: '#d9468f',
  purple: '#8a5cd6'
}
const NOTE_LINE = '#6b7c93'

const HIGHLIGHT_ALPHA = 0.4
const HIGHLIGHTER_ALPHA = 0.35
const HIGHLIGHTER_SCALE = 4 // highlighter ink is 4× the chosen width

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Underline, wavy line or dotted note line along the foot of one rect. */
function underline(ctx: Ctx, hl: Highlight, r: Rect, w: number, h: number): void {
  const unit = w / 440 // styles are tuned in CSS px for a ~440 px-wide page
  const y = (r.y + r.h) * h
  const x0 = r.x * w
  const x1 = (r.x + r.w) * w
  ctx.save()
  ctx.lineWidth = 1.5 * unit
  ctx.strokeStyle = hl.style === 'note' ? NOTE_LINE : UNDERLINE_HEX[hl.color]
  ctx.setLineDash(hl.style === 'note' ? [1.5 * unit, 2.5 * unit] : [])
  ctx.beginPath()
  ctx.moveTo(x0, y)
  if (hl.style === 'wavy') {
    const amp = 1.5 * unit
    const step = 1.5 * unit // quarter wavelength
    for (let x = x0 + step, i = 1; x < x1 + step; x += step, i++) {
      ctx.lineTo(Math.min(x, x1), y + (i % 4 === 1 ? -amp : i % 4 === 3 ? amp : 0))
    }
  } else {
    ctx.lineTo(x1, y)
  }
  ctx.stroke()
  ctx.restore()
}

function fillStroke(ctx: Ctx, s: InkStroke, w: number, h: number): void {
  const highlighter = s.tool === 'highlighter'
  const outline = strokeOutline(
    s.points,
    highlighter ? s.width * HIGHLIGHTER_SCALE : s.width,
    { w, h },
    needsSimulatedPressure(s.points)
  )
  if (outline.length === 0) return
  ctx.save()
  if (highlighter) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = HIGHLIGHTER_ALPHA
  }
  ctx.fillStyle = s.color
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1])
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * Paints a page's highlights and ink (plus an in-progress stroke) at w×h pixels. Shared by the
 * DOM overlay and the curl-texture bake so both look identical. Leaves ctx state unchanged.
 */
export function drawPageAnnotations(
  ctx: Ctx,
  ann: PageAnnotations,
  w: number,
  h: number,
  live?: InkStroke
): void {
  const fills = ann.highlights.filter((hl) => (hl.style ?? 'highlight') === 'highlight')
  if (fills.length > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = HIGHLIGHT_ALPHA
    for (const hl of fills) {
      ctx.fillStyle = HIGHLIGHT_HEX[hl.color]
      for (const r of hl.rects) ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h)
    }
    ctx.restore()
  }
  for (const hl of ann.highlights) {
    if ((hl.style ?? 'highlight') !== 'highlight')
      for (const r of hl.rects) underline(ctx, hl, r, w, h)
  }
  for (const s of ann.ink) fillStroke(ctx, s, w, h)
  if (live) fillStroke(ctx, live, w, h)
}
