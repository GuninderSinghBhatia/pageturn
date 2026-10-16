import { useEffect, useRef } from 'react'
import type { OpenedDoc } from './pdfService'
import './textLayer.css'

type Props = { doc: OpenedDoc; page: number; width: number; inert?: boolean }

/** Transparent, selectable text runs laid over a page (pdf.js TextLayer). */
export function TextLayer({ doc, page, width, inert }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || width <= 0) return
    el.replaceChildren()
    delete el.dataset.rendered
    let current = true // a cancelled render must not mark its successor as done
    const job = doc.renderTextLayer(page, el, width)
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
  }, [doc, page, width])

  return <div ref={ref} className={`textLayer${inert ? ' inert' : ''}`} />
}
