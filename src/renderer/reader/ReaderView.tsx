import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from '../app/nav'
import { displayTitle } from '../library/displayTitle'
import { useLibraryStore } from '../stores/libraryStore'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { BookStage } from './BookStage/BookStage'
import { SlideStage } from './BookStage/SlideStage'
import { FindBar } from './FindBar'
import { fitPageSize, resolveLayout, spreadFor, spreadPages } from './layout'
import { NavBar } from './NavBar'
import { PasswordPrompt } from './PasswordPrompt'
import { Prefetcher } from './pdf/prefetch'
import { TocSidebar } from './TocSidebar'
import { usePan, useViewportSize } from './useViewport'
import { useReaderKeys } from './useReaderKeys'
import styles from './Reader.module.css'

const ZOOM_SETTLE_MS = 150

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ReaderView({ bookId }: { bookId: string }): React.JSX.Element {
  const { goLibrary } = useNav()
  const r = useReaderStore()
  const settings = useSettingsStore((s) => s.settings)
  const book = useLibraryStore((s) => s.books.find((b) => b.id === bookId))
  const [tocOpen, setTocOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [banner, setBanner] = useState(false)
  const bannerShown = useRef(false)
  const pageBoxRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useViewportSize(viewportRef)
  usePan(viewportRef, r.zoom > 1)

  useEffect(() => {
    const s = useReaderStore.getState()
    s.setLayoutMode(useSettingsStore.getState().settings.layout)
    void s.open(bookId)
    return () => useReaderStore.getState().close()
  }, [bookId])

  useEffect(() => {
    if (r.status === 'cancelled') goLibrary()
  }, [r.status, goLibrary])

  // Resolve spread/single from the user's mode and the window shape.
  const { setLayout } = r
  useEffect(() => {
    if (viewport.width > 0) setLayout(resolveLayout(r.layoutMode, viewport.width / viewport.height))
  }, [viewport, r.layoutMode, setLayout])

  const spread = r.doc ? spreadFor(r.page, r.doc.numPages, r.layout) : { left: null, right: null }
  const pages = spreadPages(spread)
  const visibleLast = pages[pages.length - 1] ?? 1

  // One-time notice when a visible page has no text layer (scanned).
  const { doc } = r
  useEffect(() => {
    if (!doc || bannerShown.current) return
    let cancelled = false
    void Promise.all(pages.map((p) => doc.hasText(p))).then((has) => {
      if (cancelled || bannerShown.current || has.every(Boolean)) return
      bannerShown.current = true
      setBanner(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pages.join(',')])

  useReaderKeys({
    onFind: useCallback(() => setFindOpen(true), []),
    onFocusPageBox: useCallback(() => pageBoxRef.current?.select(), []),
    onEscape: useCallback(() => {
      setFindOpen(false)
      setTocOpen(false)
    }, [])
  })

  // Ctrl+wheel zooms (non-passive so the default page zoom is suppressed).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const s = useReaderStore.getState()
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
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

  // Neighbouring spreads are prefetched at fit size (turning is disabled while zoomed in).
  const prefetcher = useMemo(
    () => (doc ? new Prefetcher(doc, (p) => scaleAt(p, Math.min(renderZoom, 1))) : null),
    [doc, scaleAt, renderZoom]
  )
  useEffect(() => {
    if (prefetcher && viewport.width > 0) prefetcher.update(r.page, r.layout)
  }, [prefetcher, r.page, r.layout, viewport.width])

  // WebGL curl unless the user chose slide/instant, motion is reduced, zoomed in, or WebGL failed.
  const [webglFailed, setWebglFailed] = useState(false)
  const onWebglFailed = useCallback(() => setWebglFailed(true), [])
  const useCurl =
    settings.pageTurnStyle === 'curl' && !webglFailed && r.zoom <= 1 && !reducedMotion()

  const title = book ? displayTitle(book) : 'PageTurn'

  return (
    <div className={styles.reader}>
      {r.doc && (
        <NavBar
          ref={pageBoxRef}
          title={title}
          visiblePage={visibleLast}
          page={r.page}
          numPages={r.doc.numPages}
          layout={r.layout}
          zoom={r.zoom}
          onBack={goLibrary}
          onGoTo={r.goTo}
          onPrev={() => r.requestTurn(-1)}
          onNext={() => r.requestTurn(1)}
          onToggleLayout={() => r.setLayoutMode(r.layout === 'spread' ? 'single' : 'spread')}
          onToggleToc={() => setTocOpen((o) => !o)}
          onToggleFind={() => setFindOpen((o) => !o)}
          onZoom={r.setZoom}
        />
      )}
      <div className={styles.body}>
        {tocOpen && r.doc && <TocSidebar outline={r.doc.outline} onGoTo={r.goTo} />}
        <div ref={viewportRef} className={`${styles.viewport} ${r.zoom > 1 ? styles.zoomed : ''}`}>
          {r.doc && viewport.width > 0 && useCurl && (
            <BookStage
              doc={r.doc}
              layout={r.layout}
              viewport={viewport}
              pageSize={pageSize}
              scaleFor={scaleFor}
              tint={settings.paperTint}
              onFallback={onWebglFailed}
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
              animate={settings.pageTurnStyle !== 'instant' && !reducedMotion()}
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
      {findOpen && r.doc && (
        <FindBar
          doc={r.doc}
          visibleLast={visibleLast}
          onJump={r.goTo}
          onClose={() => setFindOpen(false)}
        />
      )}
      {banner && (
        <div className={styles.banner} role="status">
          This page has no selectable text.
          <button onClick={() => setBanner(false)}>Dismiss</button>
        </div>
      )}
      {r.passwordRequest && (
        <PasswordPrompt retry={r.passwordRequest.retry} onSubmit={r.submitPassword} />
      )}
    </div>
  )
}
