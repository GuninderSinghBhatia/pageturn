import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaperTint } from '@shared/types'
import { useReaderStore } from '../../stores/readerStore'
import {
  nextSpreadStart,
  prevSpreadStart,
  spreadFor,
  spreadPages,
  type ResolvedLayout,
  type Spread
} from '../layout'
import type { OpenedDoc } from '../pdf/pdfService'
import { TurnController, turnPointer, type TurnDir, type TurnState } from './turnController'
import { useTurnGesture } from './useTurnGesture'
import type { Vec2 } from './webgl/curlMath'
import { CurlRenderer, type PageTextures, type Rect } from './webgl/renderer'
import styles from '../Reader.module.css'

type Size = { width: number; height: number }
type Props = {
  doc: OpenedDoc
  layout: ResolvedLayout
  viewport: Size
  pageSize(page: number): Size // fitted CSS px
  scaleFor(page: number): number
  tint: PaperTint
  onFallback(): void // WebGL unavailable or context lost
}

/** Page rects (CSS px within the stage), centred on the spine; one shared rect in single mode. */
function computeRects(
  spread: Spread,
  layout: ResolvedLayout,
  vp: Size,
  pageSize: (p: number) => Size
): { left: Rect | null; right: Rect | null } {
  const cx = vp.width / 2
  const cy = vp.height / 2
  const rect = (p: number, x: (w: number) => number): Rect => {
    const s = pageSize(p)
    return { x: x(s.width), y: cy - s.height / 2, width: s.width, height: s.height }
  }
  if (layout === 'single') {
    const r = rect(spread.right!, (w) => cx - w / 2)
    return { left: r, right: r }
  }
  return {
    left: spread.left === null ? null : rect(spread.left, (w) => cx - w),
    right: spread.right === null ? null : rect(spread.right, () => cx)
  }
}

export function BookStage({
  doc,
  layout,
  viewport,
  pageSize,
  scaleFor,
  tint,
  onFallback
}: Props): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CurlRenderer | null>(null)
  const bitmaps = useRef(new Map<number, { scale: number; bmp: ImageBitmap }>())
  const rectsRef = useRef<{ left: Rect | null; right: Rect | null }>({ left: null, right: null })
  const frame = useRef(0)
  // Plain object (not a ref) so the controller callbacks below may flip it.
  const [committing] = useState(() => ({ current: false }))
  const drawRef = useRef<() => void>(() => undefined)
  const page = useReaderStore((s) => s.page)
  const n = doc.numPages

  const [controller] = useState(
    () =>
      new TurnController({
        canTurn: (dir) => {
          const s = useReaderStore.getState()
          if (s.zoom > 1) return false
          const step = dir === 1 ? nextSpreadStart : prevSpreadStart
          return step(s.page, s.doc?.numPages ?? 0, s.layout) !== null
        },
        commit: (dir) => {
          committing.current = true
          if (dir === 1) useReaderStore.getState().next()
          else useReaderStore.getState().prev()
          committing.current = false
        }
      })
  )

  const texturesFor = useCallback(
    (state: TurnState, cur: Spread): PageTextures => {
      const b = (p: number | null | undefined): ImageBitmap | undefined =>
        p == null ? undefined : bitmaps.current.get(p)?.bmp
      const single = layout === 'single'
      if (state.phase === 'idle') return { staticLeft: b(cur.left), staticRight: b(cur.right) }
      const start = cur.left ?? cur.right!
      if (state.dir === 1) {
        const to = spreadFor(nextSpreadStart(start, n, layout) ?? start, n, layout)
        return single
          ? { front: b(cur.right), rightUnder: b(to.right) }
          : {
              staticLeft: b(cur.left),
              front: b(cur.right),
              rightUnder: b(to.right),
              back: b(to.left)
            }
      }
      const to = spreadFor(prevSpreadStart(start, n, layout) ?? start, n, layout)
      return single
        ? { front: b(cur.right), leftUnder: b(to.right) }
        : {
            staticRight: b(cur.right),
            front: b(cur.left),
            leftUnder: b(to.left),
            back: b(to.right)
          }
    },
    [layout, n]
  )

  const draw = useCallback(() => {
    frame.current = 0
    const r = rendererRef.current
    const el = stageRef.current
    if (!r || !el) return
    const state = controller.tick(performance.now())
    const s = useReaderStore.getState()
    const spread = spreadFor(s.page, n, layout)
    const rects = computeRects(spread, layout, viewport, pageSize)
    rectsRef.current = rects
    r.setLayout(rects)
    r.setPages(texturesFor(state, spread))
    r.setProgress(n > 1 ? (s.page - 1) / (n - 1) : 0)
    let ptr: Vec2 | null = null
    if (state.phase !== 'idle') {
      const turning = state.dir === 1 ? rects.right : rects.left
      ptr = turning && turnPointer(state, turning.height / turning.width)
    }
    r.draw(ptr && state.phase !== 'idle' ? { corner: state.corner, pointer: ptr } : null)

    const pages = spreadPages(spread)
    const ready = pages.every((p) => bitmaps.current.has(p))
    const idle = state.phase === 'idle'
    el.dataset.ready = String(ready)
    el.dataset.pages = pages.join(',')
    el.dataset.settled = String(idle && ready)
    const rr = rects.right ?? rects.left
    if (rr) el.dataset.rightRect = [rr.x, rr.y, rr.width, rr.height].map(Math.round).join(',')
    if (s.turning === idle) useReaderStore.setState({ turning: !idle })
    if (!idle) frame.current = requestAnimationFrame(() => drawRef.current())
    else r.preload([...bitmaps.current.values()].map((v) => v.bmp)) // upload while idle
  }, [controller, layout, n, viewport, pageSize, texturesFor])

  useEffect(() => {
    drawRef.current = draw
  }, [draw])
  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => drawRef.current())
  }, [])

  // Renderer lifetime; key/nav turns are routed here while mounted.
  useEffect(() => {
    let r: CurlRenderer
    try {
      r = new CurlRenderer(canvasRef.current!)
    } catch (err) {
      console.warn('Page curl unavailable, using slide transition', err)
      onFallback()
      return
    }
    r.onContextLost(onFallback)
    rendererRef.current = r
    const store = useReaderStore.getState()
    store.setTurnHandler((dir: TurnDir) => {
      controller.turn(dir)
      if (stageRef.current && controller.current.phase !== 'idle') {
        stageRef.current.dataset.settled = 'false'
      }
      requestDraw()
    })
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      useReaderStore.getState().setTurnHandler(null)
      useReaderStore.setState({ turning: false })
      controller.reset()
      r.dispose()
      rendererRef.current = null
    }
  }, [controller, onFallback, requestDraw])

  useEffect(() => {
    rendererRef.current?.setViewport(viewport.width, viewport.height)
    requestDraw()
  }, [viewport, requestDraw])

  useEffect(() => {
    rendererRef.current?.setTint(tint)
    requestDraw()
  }, [tint, requestDraw])

  // Jumps that bypass the controller (page box, TOC, find) cancel any turn in progress.
  useEffect(
    () =>
      useReaderStore.subscribe((s, prev) => {
        if (s.page === prev.page) return
        if (!committing.current) controller.reset()
        requestDraw()
      }),
    [controller, committing, requestDraw]
  )

  // Keep bitmaps for the current spread and one spread either side.
  useEffect(() => {
    let cancelled = false
    const start = spreadFor(page, n, layout)
    const first = start.left ?? start.right!
    const needed = new Set<number>()
    for (const s of [first, nextSpreadStart(first, n, layout), prevSpreadStart(first, n, layout)]) {
      if (s !== null) spreadPages(spreadFor(s, n, layout)).forEach((p) => needed.add(p))
    }
    for (const p of [...bitmaps.current.keys()]) if (!needed.has(p)) bitmaps.current.delete(p)
    for (const p of needed) {
      const scale = scaleFor(p)
      if (bitmaps.current.get(p)?.scale === scale) continue
      doc
        .renderPage(p, scale)
        .then((bmp) => {
          if (cancelled) return
          bitmaps.current.set(p, { scale, bmp })
          requestDraw()
        })
        .catch((err) => console.error(`Render failed for page ${p}`, err))
    }
    requestDraw()
    return () => {
      cancelled = true
    }
  }, [doc, page, layout, n, scaleFor, requestDraw])

  useTurnGesture({
    stageRef,
    controller,
    rects: useCallback(() => rectsRef.current, []),
    onChange: requestDraw
  })

  return (
    <div
      ref={stageRef}
      className={styles.curlStage}
      data-testid="book-stage"
      data-stage="curl"
      data-ready="false"
      data-settled="false"
    >
      <canvas ref={canvasRef} className={styles.curlCanvas} />
    </div>
  )
}
