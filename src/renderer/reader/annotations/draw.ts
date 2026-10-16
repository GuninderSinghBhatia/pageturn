import type { HighlightColor, InkStroke } from '@shared/types'
import type { PageAnnotations } from '../../stores/annotationStore'
import { needsSimulatedPressure, strokeOutline } from '../ink/strokes'

export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  yellow: '#ffd84d',
  green: '#7ed87e',
  blue: '#7fb8ff',
  pink: '#ff9ccf',
  purple: '#c49cff'
}

const HIGHLIGHT_ALPHA = 0.4
const HIGHLIGHTER_ALPHA = 0.35
const HIGHLIGHTER_SCALE = 4 // highlighter ink is 4× the chosen width

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

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
  if (ann.highlights.length > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = HIGHLIGHT_ALPHA
    for (const hl of ann.highlights) {
      ctx.fillStyle = HIGHLIGHT_HEX[hl.color]
      for (const r of hl.rects) ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h)
    }
    ctx.restore()
  }
  for (const s of ann.ink) fillStroke(ctx, s, w, h)
  if (live) fillStroke(ctx, live, w, h)
}
