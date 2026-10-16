import { useEffect, useRef } from 'react'
import { selectPage, useAnnotationStore } from '../../stores/annotationStore'
import type { OpenedDoc } from '../pdf/pdfService'
import { TextLayer } from '../pdf/TextLayer'
import { drawPageAnnotations } from './draw'
import styles from './Annotations.module.css'

type Props = { doc: OpenedDoc; page: number; width: number; height: number }

/** Renders the overlay for one page at its displayed CSS size (passed to both stages). */
export type OverlayRenderer = (
  page: number,
  size: { width: number; height: number }
) => React.ReactNode

/**
 * Everything drawn over one settled page: the annotation canvas (highlights + ink), the
 * selectable text layer, and interactive annotation controls (marked data-no-turn).
 */
export function PageOverlay({ doc, page, width, height }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ann = useAnnotationStore((s) => selectPage(s, page))

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

  return (
    <div className={styles.overlay} data-page-overlay={page} style={{ width, height }}>
      <canvas ref={canvasRef} className={styles.annotationCanvas} style={{ width, height }} />
      <TextLayer doc={doc} page={page} width={width} />
    </div>
  )
}
