import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from '../app/nav'
import { useAnnotationStore } from '../stores/annotationStore'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { PageMenu } from './annotations/PageMenu'
import { PageOverlay } from './annotations/PageOverlay'
import { highlightSelection } from './annotations/selection'
import { PhraseCard, SelectionMenu } from './annotations/SelectionMenu'
import { makeNote, showCard } from './annotations/selectionActions'
import { useOverlayUi } from './annotations/uiStore'
import { BookStage } from './BookStage/BookStage'
import { SlideStage } from './BookStage/SlideStage'
import { resetChrome, useChromeStore } from './chrome/chromeStore'
import { ReaderToolbar } from './chrome/ReaderToolbar'
import { useIdle } from './chrome/useIdle'
import { useTextTool } from './chrome/useTextTool'
import { InkHost } from './ink/InkHost'
import inkStyles from './ink/Ink.module.css'
import { useInkStore } from './ink/inkStore'
import { fitPageSize, resolveLayout, spreadFor, spreadPages } from './layout'
import { PasswordPrompt } from './PasswordPrompt'
import { Prefetcher } from './pdf/prefetch'
import { toggleFullscreen, useReaderKeys } from './useReaderKeys'
import { usePan, useViewportSize } from './useViewport'
import styles from './Reader.module.css'

const ZOOM_SETTLE_MS = 150

/** Pages of the spread on screen right now (lowest first). */
function spreadPagesNow(): number[] {
  const s = useReaderStore.getState()
  return s.doc ? spreadPages(spreadFor(s.page, s.doc.numPages, s.layout)) : []
}

const bookmarkFirstVisible = (): void => {
  const first = spreadPagesNow()[0]
  if (first) useAnnotationStore.getState().toggleBookmark(first)
}

/** The open book and nothing else; tools appear on demand (top edge, right-click, keys). */
export function ReaderView({ bookId }: { bookId: string }): React.JSX.Element {
  const { goLibrary } = useNav()
  const r = useReaderStore()
  const settings = useSettingsStore((s) => s.settings)
  const scannedNoticeShown = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useViewportSize(viewportRef)
  useTextTool(viewportRef)

  useEffect(() => {
    const s = useReaderStore.getState()
    s.setLayoutMode(useSettingsStore.getState().settings.layout)
    void s.open(bookId)
    void useAnnotationStore
      .getState()
      .load(bookId)
      .catch((err) => console.error('Could not load annotations', err))
    return () => {
      useReaderStore.getState().close()
      useAnnotationStore.getState().clear()
      resetChrome()
    }
  }, [bookId])

  useEffect(() => {
    if (r.status === 'cancelled') goLibrary()
  }, [r.status, goLibrary])

  // Cards and menus close when the page turns.
  useEffect(
    () =>
      useReaderStore.subscribe((s, prev) => {
        if (s.page !== prev.page) useOverlayUi.getState().closeAll()
      }),
    []
  )

  // Resolve spread/single from the user's mode and the window shape.
  const { setLayout } = r
  useEffect(() => {
    if (viewport.width > 0)
      setLayout(resolveLayout(r.layoutMode, viewport.width / viewport.height, viewport.width))
  }, [viewport, r.layoutMode, setLayout])

  const spread = r.doc ? spreadFor(r.page, r.doc.numPages, r.layout) : { left: null, right: null }
  const pages = spreadPages(spread)
  const visibleLast = pages[pages.length - 1] ?? 1

  // One-time notice when a visible page has no text layer (scanned).
  const { doc } = r
  useEffect(() => {
    if (!doc || scannedNoticeShown.current) return
    let cancelled = false
    void Promise.all(pages.map((p) => doc.hasText(p))).then((has) => {
      if (cancelled || scannedNoticeShown.current || has.every(Boolean)) return
      scannedNoticeShown.current = true
      useToastStore.getState().show('This page has no selectable text.')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pages.join(',')])

  useReaderKeys({
    onFind: useCallback(() => useChromeStore.getState().openWith('search'), []),
    onFocusPageBox: useCallback(() => useChromeStore.getState().openPageBox(), []),
    onToggleToolbar: useCallback(() => useChromeStore.getState().toggleToolbar(), []),
    onEscape: useCallback(() => {
      if (useOverlayUi.getState().closeAll()) return true
      return useChromeStore.getState().escape()
    }, []),
    onEraser: useCallback(() => {
      useChromeStore.getState().setTextTool(null)
      useInkStore.getState().setMode({ active: true, tool: 'eraser' })
    }, []),
    onUndo: useCallback(() => useInkStore.getState().undo(), []),
    onRedo: useCallback(() => useInkStore.getState().redo(), []),
    onTogglePen: useCallback(() => {
      const ink = useInkStore.getState()
      useChromeStore.getState().setTextTool(null)
      ink.setMode({
        active: !ink.mode.active,
        tool: ink.mode.tool === 'eraser' ? 'pen' : ink.mode.tool
      })
    }, []),
    onBookmark: bookmarkFirstVisible,
    onNote: useCallback(() => makeNote(viewportRef.current), []),
    onAsk: useCallback(() => showCard(viewportRef.current, 'ai'), []),
    onHighlight: useCallback(
      () =>
        highlightSelection(
          viewportRef.current,
          useSettingsStore.getState().settings.highlightColor
        ),
      []
    )
  })

  // Ctrl+wheel zooms (non-passive so the default page zoom is suppressed).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = useReaderStore.getState()
      // Proportional to the scroll amount: trackpads zoom continuously, wheels in small steps.
      s.setZoom(s.zoom * Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pageSize = useCallback(
    (p: number) =>
      doc ? fitPageSize(doc.pageSize(p), viewport, r.layout) : { width: 0, height: 0 },
    [doc, viewport, r.layout]
  )

  // Re-render at a new resolution only once zooming settles; until then the old bitmap stretches.
  const [renderZoom, setRenderZoom] = useState(r.zoom)
  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(r.zoom), ZOOM_SETTLE_MS)
    return () => clearTimeout(t)
  }, [r.zoom])

  const scaleAt = useCallback(
    (p: number, zoom: number) =>
      doc ? (window.devicePixelRatio * pageSize(p).width * zoom) / doc.pageSize(p).width : 1,
    [doc, pageSize]
  )
  const scaleFor = useCallback((p: number) => scaleAt(p, renderZoom), [scaleAt, renderZoom])
  const fitScaleFor = useCallback(
    (p: number) => scaleAt(p, Math.min(renderZoom, 1)),
    [scaleAt, renderZoom]
  )

  // Neighbouring spreads are prefetched at fit size (turning is disabled while zoomed in).
  const prefetcher = useMemo(
    () => (doc ? new Prefetcher(doc, (p) => scaleAt(p, Math.min(renderZoom, 1))) : null),
    [doc, scaleAt, renderZoom]
  )
  useEffect(() => {
    if (prefetcher && viewport.width > 0) prefetcher.update(r.page, r.layout)
  }, [prefetcher, r.page, r.layout, viewport.width])

  // WebGL page flip unless the user chose slide/instant (Settings) or WebGL failed.
  const [webglFailed, setWebglFailed] = useState(false)
  const onWebglFailed = useCallback(() => setWebglFailed(true), [])
  const useCurl = settings.pageTurnStyle === 'curl' && !webglFailed
  // The page-flip view pans itself; the slide fallback scrolls its container.
  usePan(viewportRef, r.zoom > 1 && !useCurl)

  const renderOverlay = useCallback(
    (p: number, size: { width: number; height: number }) =>
      doc ? <PageOverlay doc={doc} page={p} width={size.width} height={size.height} /> : null,
    [doc]
  )

  const penActive = useInkStore((s) => s.mode.active)

  // A normal window takes the book's shape (no empty space around the pages). A spread is
  // always two pages wide (the cover sits on the right half).
  const firstPage = pages[0]
  const bookAspect = doc
    ? ((r.layout === 'spread' ? 2 : 1) * doc.pageSize(firstPage ?? 1).width) /
      doc.pageSize(firstPage ?? 1).height
    : 0
  useEffect(() => {
    if (bookAspect > 0) void window.api.window.fitAspect(Math.round(bookAspect * 1000) / 1000)
  }, [bookAspect])
  useEffect(() => () => void window.api.window.fitAspect(0), [])
  const idle = useIdle()

  return (
    <div className={styles.reader} data-reader data-idle={String(idle && !penActive)}>
      {/* Thin grab strip along the top edge for moving the window (OS title bar is hidden). */}
      <div className={`${styles.dragStrip} app-drag`} />
      {r.doc && (
        <ReaderToolbar
          doc={r.doc}
          visiblePage={visibleLast}
          zoom={r.zoom}
          layout={r.layout}
          onBack={goLibrary}
          onGoTo={r.goTo}
          onBookmark={bookmarkFirstVisible}
          onZoom={r.setZoom}
          onLayout={(l) => r.setLayoutMode(l)}
          onFullscreen={toggleFullscreen}
        />
      )}
      <div className={styles.body}>
        {r.doc && <InkHost viewportRef={viewportRef} />}
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${r.zoom > 1 && !useCurl ? styles.zoomed : ''} ${penActive ? inkStyles.penMode : ''}`}
        >
          {r.doc && viewport.width > 0 && useCurl && (
            <BookStage
              doc={r.doc}
              layout={r.layout}
              viewport={viewport}
              pageSize={pageSize}
              scaleFor={scaleFor}
              fitScaleFor={fitScaleFor}
              zoom={r.zoom}
              tint={settings.paperTint}
              onFallback={onWebglFailed}
              renderOverlay={renderOverlay}
            />
          )}
          {r.doc && viewport.width > 0 && !useCurl && (
            <SlideStage
              doc={r.doc}
              spread={spread}
              layout={r.layout}
              pageSize={pageSize}
              zoom={r.zoom}
              scaleFor={scaleFor}
              animate={settings.pageTurnStyle !== 'instant'}
              renderOverlay={renderOverlay}
            />
          )}
          {r.status === 'loading' && !r.passwordRequest && (
            <p className={styles.status}>Opening…</p>
          )}
          {r.status === 'error' && (
            <div className={styles.status}>
              <p>Couldn’t open this PDF.</p>
              <p className={styles.muted}>{r.error}</p>
              <button onClick={goLibrary}>Back to library</button>
            </div>
          )}
        </div>
      </div>
      {r.doc && <SelectionMenu rootRef={viewportRef} />}
      <PhraseCard />
      {r.doc && <PageMenu rootRef={viewportRef} />}
      {r.passwordRequest && (
        <PasswordPrompt retry={r.passwordRequest.retry} onSubmit={r.submitPassword} />
      )}
    </div>
  )
}
