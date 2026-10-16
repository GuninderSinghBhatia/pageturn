import { useCallback, useEffect, useRef, useState } from 'react'
import { selectPage, useAnnotationStore } from '../../stores/annotationStore'
import type { OpenedDoc } from '../pdf/pdfService'
import { TextLayer } from '../pdf/TextLayer'
import { drawPageAnnotations } from './draw'
import { HighlightPopover } from './HighlightPopover'
import { hitHighlight } from './rects'
import styles from './Annotations.module.css'

type Props = { doc: OpenedDoc; page: number; width: number; height: number }

/** Renders the overlay for one page at its displayed CSS size (passed to both stages). */
export type OverlayRenderer = (
  page: number,
  size: { width: number; height: number }
) => React.ReactNode

type Open = { id: string; at: { x: number; y: number } }

/**
 * Everything drawn over one settled page: the annotation canvas (highlights + ink), the
 * selectable text layer, and interactive annotation controls (marked data-no-turn).
 */
export function PageOverlay({ doc, page, width, height }: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ann = useAnnotationStore((s) => selectPage(s, page))
  const [open, setOpen] = useState<Open | null>(null)
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawPageAnnotations(ctx, ann, canvas.width, canvas.height)
  }, [ann, width, height])

  // Page-local point (CSS px and normalized) of a pointer event.
  const locate = useCallback((e: { clientX: number; clientY: number }) => {
    const b = rootRef.current!.getBoundingClientRect()
    const x = e.clientX - b.left
    const y = e.clientY - b.top
    return { px: { x, y }, norm: { x: x / b.width, y: y / b.height } }
  }, [])

  // A press on highlighted text belongs to the highlight: keep it from turning the page.
  // Native listener, so it runs before the stage's own (ancestor) listener.
  const highlights = ann.highlights
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const down = (e: PointerEvent): void => {
      if (hitHighlight(highlights, locate(e).norm)) e.stopPropagation()
    }
    el.addEventListener('pointerdown', down)
    return () => el.removeEventListener('pointerdown', down)
  }, [highlights, locate])

  const onClick = (e: React.MouseEvent): void => {
    if (!(window.getSelection()?.isCollapsed ?? true)) return // finishing a text selection
    const { px, norm } = locate(e)
    const hit = hitHighlight(highlights, norm)
    if (hit) setOpen({ id: hit.id, at: px })
  }

  const openHighlight = open && highlights.find((h) => h.id === open.id)

  return (
    <div
      ref={rootRef}
      className={styles.overlay}
      data-page-overlay={page}
      style={{ width, height }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className={styles.annotationCanvas} style={{ width, height }} />
      <TextLayer doc={doc} page={page} width={width} />
      {openHighlight && (
        <HighlightPopover
          key={openHighlight.id}
          highlight={openHighlight}
          at={open.at}
          onClose={close}
        />
      )}
    </div>
  )
}
