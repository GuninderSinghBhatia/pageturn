import type { HighlightColor, Rect } from '@shared/types'
import { useAnnotationStore } from '../../stores/annotationStore'
import { mergeLineRects, normalizeRects } from './rects'

export type PageSelection = { page: number; text: string; rects: Rect[] }

/** Ranges covering the selected part of each text node of `layer` (one per text run). */
function selectedPieces(range: Range, layer: Element): Range[] {
  const pieces: Range[] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    const piece = document.createRange()
    piece.selectNodeContents(node)
    if (node === range.startContainer) piece.setStart(node, range.startOffset)
    if (node === range.endContainer) piece.setEnd(node, range.endOffset)
    if (!piece.collapsed) pieces.push(piece)
  }
  return pieces
}

/**
 * Splits the current selection into one entry per page overlay it touches, each with that
 * page's text and its rects (normalized to the page, merged per line). Measuring only text
 * nodes keeps pdf.js helper elements (line breaks, end-of-content) out of the rects.
 */
export function selectionByPage(sel: Selection, root: HTMLElement): PageSelection[] {
  if (sel.rangeCount === 0 || sel.isCollapsed) return []
  const range = sel.getRangeAt(0)
  const out: PageSelection[] = []
  for (const overlay of root.querySelectorAll<HTMLElement>('[data-page-overlay]')) {
    const layer = overlay.querySelector('.textLayer')
    if (!layer || !range.intersectsNode(layer)) continue
    const pieces = selectedPieces(range, layer)
    const box = overlay.getBoundingClientRect()
    const client = pieces.flatMap((p) => [...p.getClientRects()])
    const rects = mergeLineRects(normalizeRects(client, box))
    const text = pieces
      .map((p) => p.toString())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (rects.length > 0 && text)
      out.push({ page: Number(overlay.dataset.pageOverlay), text, rects })
  }
  return out
}

/** Highlights the current selection inside `root` in `color`; returns false if nothing to do. */
export function highlightSelection(root: HTMLElement | null, color: HighlightColor): boolean {
  const sel = window.getSelection()
  if (!root || !sel) return false
  const parts = selectionByPage(sel, root)
  if (parts.length === 0) return false
  useAnnotationStore.getState().addHighlights(parts.map((p) => ({ ...p, color })))
  sel.removeAllRanges()
  return true
}

/** True when the selection is non-empty and sits in a page's text layer under `root`. */
export function hasTextSelection(root: HTMLElement | null): boolean {
  const sel = window.getSelection()
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return false
  const node = sel.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  return !!el?.closest('.textLayer') && root.contains(el)
}
