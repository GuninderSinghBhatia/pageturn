import { useCallback, useEffect, useRef, useState } from 'react'
import { spreadPages, type ResolvedLayout, type Spread } from '../layout'
import type { OpenedDoc } from '../pdf/pdfService'
import { PageCanvas, type PageState } from './PageCanvas'
import styles from '../Reader.module.css'

type Props = {
  doc: OpenedDoc
  spread: Spread
  layout: ResolvedLayout
  pageSize(page: number): { width: number; height: number } // fitted CSS px at zoom 1
  zoom: number
  scaleFor(page: number): number // pdf.js render scale for a page
  animate: boolean // false for 'instant' turns
}

/**
 * Renders the current spread as canvases; a new spread slides in from the turn direction.
 * Used for the 'slide'/'instant' styles and as the WebGL fallback.
 */
export function SlideStage({
  doc,
  spread,
  layout,
  pageSize,
  zoom,
  scaleFor,
  animate
}: Props): React.JSX.Element {
  const pages = spreadPages(spread)
  const key = pages.join('-')
  const first = pages[0]
  const prevFirst = useRef(first)
  const [dir, setDir] = useState<1 | -1 | 0>(0)
  const [states, setStates] = useState<Record<number, PageState>>({})

  useEffect(() => {
    if (first !== prevFirst.current) setDir(first > prevFirst.current ? 1 : -1)
    prevFirst.current = first
  }, [first])

  const onState = useCallback((page: number, s: PageState) => {
    setStates((cur) => (cur[page] === s ? cur : { ...cur, [page]: s }))
  }, [])

  const ready = pages.every((p) => states[p] === 'ready' || states[p] === 'error')
  const slot = (p: number | null, fallback: number): { width: number; height: number } => {
    const s = pageSize(p ?? fallback)
    return { width: s.width * zoom, height: s.height * zoom }
  }

  const renderSlot = (p: number | null, side: 'left' | 'right'): React.JSX.Element | null => {
    if (layout === 'single' && side === 'left') return null
    const size = slot(p, pages[0])
    if (p === null) return <div className={styles.emptySlot} style={size} />
    return <PageCanvas key={p} doc={doc} page={p} {...size} scale={scaleFor(p)} onState={onState} />
  }

  const anim = !animate || dir === 0 ? '' : dir > 0 ? styles.slideFromRight : styles.slideFromLeft

  return (
    <div
      className={styles.stage}
      data-testid="book-stage"
      data-stage="slide"
      data-settled={ready ? 'true' : 'false'}
      data-ready={ready ? 'true' : 'false'}
      data-pages={pages.join(',')}
    >
      <div key={key} className={`${styles.spread} ${anim}`}>
        {renderSlot(spread.left, 'left')}
        {spread.left !== null && spread.right !== null && <div className={styles.gutter} />}
        {renderSlot(spread.right, 'right')}
      </div>
    </div>
  )
}
