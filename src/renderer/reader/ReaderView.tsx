import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../app/nav'
import { displayTitle } from '../library/displayTitle'
import { useLibraryStore } from '../stores/libraryStore'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SlideStage } from './BookStage/SlideStage'
import { FindBar } from './FindBar'
import { fitPageSize, resolveLayout, spreadFor, spreadPages } from './layout'
import { NavBar } from './NavBar'
import { PasswordPrompt } from './PasswordPrompt'
import { TocSidebar } from './TocSidebar'
import { usePan, useViewportSize } from './useViewport'
import { useReaderKeys } from './useReaderKeys'
import styles from './Reader.module.css'

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
          onPrev={r.prev}
          onNext={r.next}
          onToggleLayout={() => r.setLayoutMode(r.layout === 'spread' ? 'single' : 'spread')}
          onToggleToc={() => setTocOpen((o) => !o)}
          onToggleFind={() => setFindOpen((o) => !o)}
          onZoom={r.setZoom}
        />
      )}
      <div className={styles.body}>
        {tocOpen && r.doc && <TocSidebar outline={r.doc.outline} onGoTo={r.goTo} />}
        <div ref={viewportRef} className={`${styles.viewport} ${r.zoom > 1 ? styles.zoomed : ''}`}>
          {r.doc && viewport.width > 0 && (
            <SlideStage
              doc={r.doc}
              spread={spread}
              layout={r.layout}
              pageSize={pageSize}
              zoom={r.zoom}
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
