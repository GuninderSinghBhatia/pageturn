import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { OpenedDoc } from '../pdf/pdfService'
import styles from '../Reader.module.css'

export type PageState = 'loading' | 'ready' | 'error'

type Props = {
  doc: OpenedDoc
  page: number
  width: number // CSS px (already includes zoom)
  height: number
  scale: number // render scale; may lag width while zoom settles (old bitmap is stretched)
  onState(page: number, state: PageState): void
  overlay?: ReactNode // annotation/text overlay, laid over the canvas
}

/** One PDF page drawn at devicePixelRatio × displayed size, with a retry on failure. */
export function PageCanvas({
  doc,
  page,
  width,
  height,
  scale,
  onState,
  overlay
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<PageState>('loading')
  const [attempt, setAttempt] = useState(0)
  // Once drawn, keep the overlay while re-rendering at a new zoom (no text/highlight flicker).
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let cancelled = false
    const report = (s: PageState): void => {
      if (cancelled) return
      setState(s)
      onState(page, s)
    }
    report('loading')
    doc
      .renderPage(page, scale)
      .then((bmp) => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        canvas.width = bmp.width
        canvas.height = bmp.height
        canvas.getContext('2d')!.drawImage(bmp, 0, 0)
        setRendered(true)
        report('ready')
      })
      .catch((err) => {
        console.error(`Render failed for page ${page}`, err)
        report('error')
      })
    return () => {
      cancelled = true
    }
  }, [doc, page, scale, onState, attempt])

  return (
    <div className={styles.page} style={{ width, height }} data-page={page}>
      <canvas ref={canvasRef} className={styles.canvas} style={{ width, height }} />
      {(state === 'ready' || rendered) && overlay}
      {state === 'error' && (
        <div className={styles.pageError}>
          <p>Couldn’t render page {page}</p>
          <button onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </div>
      )}
    </div>
  )
}
