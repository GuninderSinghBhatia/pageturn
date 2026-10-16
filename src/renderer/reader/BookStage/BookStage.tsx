import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaperTint } from '@shared/types'
import { selectPage, useAnnotationStore } from '../../stores/annotationStore'
import { useReaderStore } from '../../stores/readerStore'
import {
  nextSpreadStart,
  prevSpreadStart,
  spreadFor,
  spreadPages,
  type ResolvedLayout,
  type Spread
} from '../layout'
import type { OverlayRenderer } from '../annotations/PageOverlay'
import type { OpenedDoc } from '../pdf/pdfService'
import { BakeCache } from './bake'
import { stageTextures } from './stageTextures'
import { computeRects, viewRects } from './pageRects'
import { usePanZoom } from './usePanZoom'
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
  scaleFor(page: number): number // render scale for pages on screen (follows zoom)
  fitScaleFor(page: number): number // render scale for neighbours (turning happens at fit)
  zoom: number
  tint: PaperTint
  onFallback(): void // WebGL unavailable or context lost
  renderOverlay?: OverlayRenderer
}

export function BookStage({
  doc,
  layout,
  viewport,
  pageSize,
  scaleFor,
  fitScaleFor,
  zoom,
  tint,
  onFallback,
  renderOverlay
}: Props): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CurlRenderer | null>(null)
  const bitmaps = useRef(new Map<number, { scale: number; bmp: ImageBitmap }>())
  const rectsRef = useRef<{ left: Rect | null; right: Rect | null }>({ left: null, right: null })
  const frame = useRef(0)
  // Plain object (not a ref) so the controller callbacks below may flip it.
  const [committing] = useState(() => ({ current: false }))
  const drawRef = useRef<() => void>(() => undefined)
  const [bakes] = useState(() => new BakeCache())
  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => drawRef.current())
  }, [])
  const fitRects = useCallback(
    () =>
      computeRects(
        spreadFor(useReaderStore.getState().page, doc.numPages, layout),
        layout,
        viewport,
        pageSize
      ),
    [doc, layout, viewport, pageSize]
  )
  const { pan, panRef } = usePanZoom({ stageRef, zoom, viewport, fitRects, onChange: requestDraw })
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

  /** Page bitmap with annotations painted in (the raw bitmap if it has none). */
  const baked = useCallback(
    (p: number): ImageBitmap | undefined => {
      const raw = bitmaps.current.get(p)?.bmp
      if (!raw) return undefined
      const a = useAnnotationStore.getState()
      return bakes.get(p, raw, a.revision[p] ?? 0, selectPage(a, p))
    },
    [bakes]
  )

  // Settled pages use raw bitmaps (the DOM overlay draws annotations on top); turning pages
  // use baked ones so annotations move with the paper.
  const texturesFor = useCallback(
    (state: TurnState, cur: Spread): PageTextures =>
      stageTextures(state, cur, layout, n, (p) =>
        state.phase === 'idle' ? bitmaps.current.get(p)?.bmp : baked(p)
      ),
    [layout, n, baked]
  )

  const draw = useCallback(() => {
    frame.current = 0
    const r = rendererRef.current
    const el = stageRef.current
    if (!r || !el) return
    const state = controller.tick(performance.now())
    const s = useReaderStore.getState()
    const spread = spreadFor(s.page, n, layout)
    const rects = viewRects(
      computeRects(spread, layout, viewport, pageSize),
      viewport,
      zoom,
      panRef.current
    )
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
    // Overlays (text, annotations) only sit on settled pages; the curl shows baked textures.
    if (overlayRef.current) overlayRef.current.style.visibility = idle ? 'visible' : 'hidden'
    const rr = rects.right ?? rects.left
    if (rr) el.dataset.rightRect = [rr.x, rr.y, rr.width, rr.height].map(Math.round).join(',')
    if (s.turning === idle) useReaderStore.setState({ turning: !idle })
    if (!idle) frame.current = requestAnimationFrame(() => drawRef.current())
    else {
      // While idle, bake and upload everything a turn may need so it starts without a hitch.
      const held = [...bitmaps.current.keys()]
      bakes.retain(new Set(held))
      const bakedNow = held.map(baked).filter((b): b is ImageBitmap => !!b)
      r.preload([...[...bitmaps.current.values()].map((v) => v.bmp), ...bakedNow])
    }
    el.dataset.baked = bakes.bakedPages().join(',')
  }, [controller, layout, n, viewport, pageSize, zoom, panRef, texturesFor, bakes, baked])

  useEffect(() => {
    drawRef.current = draw
  }, [draw])

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
      bakes.clear()
      r.dispose()
      rendererRef.current = null
    }
  }, [controller, onFallback, requestDraw, bakes])

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

  // Annotation edits re-bake (on the next draw) the pages they touch.
  useEffect(
    () => useAnnotationStore.subscribe((s, prev) => s.revision !== prev.revision && requestDraw()),
    [requestDraw]
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
    const onScreen = new Set(spreadPages(start))
    for (const p of needed) {
      const scale = onScreen.has(p) ? scaleFor(p) : fitScaleFor(p)
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
  }, [doc, page, layout, n, scaleFor, fitScaleFor, requestDraw])

  // Settled spread's page rects, for positioning the overlays.
  const settledSpread = spreadFor(page, n, layout)
  const settledRects = viewRects(
    computeRects(settledSpread, layout, viewport, pageSize),
    viewport,
    zoom,
    pan
  )
  const overlayPages = spreadPages(settledSpread).map((p) => ({
    page: p,
    rect: (layout === 'single' || p === settledSpread.right
      ? settledRects.right
      : settledRects.left)!
  }))

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
      {renderOverlay && (
        <div ref={overlayRef} className={styles.curlOverlay}>
          {overlayPages.map(({ page: p, rect }) => (
            <div
              key={p}
              className={styles.curlOverlayPage}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              {renderOverlay(p, { width: rect.width, height: rect.height })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
