import { useEffect, useRef, useState } from 'react'
import type { OpenedDoc } from './pdfService'
import './textLayer.css'

type Props = { doc: OpenedDoc; page: number; width: number; inert?: boolean }

const RELAYOUT_MS = 180 // while zooming, scale the laid-out text; re-lay it out once it settles

/** Transparent, selectable text runs laid over a page (pdf.js TextLayer). */
export function TextLayer({ doc, page, width, inert }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [layoutWidth, setLayoutWidth] = useState(width)

  useEffect(() => {
    const t = setTimeout(() => setLayoutWidth(width), RELAYOUT_MS)
    return () => clearTimeout(t)
  }, [width])

  useEffect(() => {
    const el = ref.current
    if (!el || layoutWidth <= 0) return
    el.replaceChildren()
    delete el.dataset.rendered
    let current = true // a cancelled render must not mark its successor as done
    const job = doc.renderTextLayer(page, el, layoutWidth)
    job.done
      .then(() => {
        if (current) el.dataset.rendered = 'true'
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortException') console.warn(`Text layer ${page}`, err)
      })
    return () => {
      current = false
      job.cancel()
    }
  }, [doc, page, layoutWidth])

  const k = layoutWidth > 0 ? width / layoutWidth : 1
  return (
    <div
      ref={ref}
      className={`textLayer${inert ? ' inert' : ''}`}
      style={k !== 1 ? { transform: `scale(${k})`, transformOrigin: '0 0' } : undefined}
    />
  )
}
