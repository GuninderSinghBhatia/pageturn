import { forwardRef, useEffect, useState } from 'react'
import type { ResolvedLayout } from './layout'
import styles from './Reader.module.css'

type Props = {
  title: string
  visiblePage: number // highest page on screen
  page: number
  numPages: number
  layout: ResolvedLayout
  zoom: number
  onBack(): void
  onGoTo(page: number): void
  onPrev(): void
  onNext(): void
  onToggleLayout(): void
  onToggleToc(): void
  onToggleFind(): void
  onZoom(z: number): void
  onSettings(): void
}

export const NavBar = forwardRef<HTMLInputElement, Props>(function NavBar(p, pageBoxRef) {
  const [draft, setDraft] = useState(String(p.visiblePage))
  useEffect(() => setDraft(String(p.visiblePage)), [p.visiblePage])

  const commit = (): void => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) p.onGoTo(n)
    else setDraft(String(p.visiblePage))
  }

  return (
    <header className={styles.navbar}>
      <button className={styles.navBtn} onClick={p.onBack} title="Back to library">
        ← Library
      </button>
      <button className={styles.navBtn} onClick={p.onToggleToc} title="Table of contents">
        ☰
      </button>
      <span className={styles.navTitle} title={p.title}>
        {p.title}
      </span>

      <button className={styles.navBtn} onClick={p.onPrev} title="Previous (←)">
        ‹
      </button>
      <input
        ref={pageBoxRef}
        className={styles.pageBox}
        data-testid="page-box"
        aria-label="Page"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
        }}
        onBlur={commit}
      />
      <span className={styles.pageTotal}>/ {p.numPages}</span>
      <button className={styles.navBtn} onClick={p.onNext} title="Next (→)">
        ›
      </button>
      <input
        className={styles.slider}
        type="range"
        min={1}
        max={p.numPages}
        value={p.page}
        aria-label="Progress"
        onChange={(e) => p.onGoTo(Number(e.target.value))}
      />

      <button className={styles.navBtn} onClick={p.onToggleLayout} title="Toggle layout">
        {p.layout === 'spread' ? 'Single page' : 'Two pages'}
      </button>
      <button className={styles.navBtn} onClick={() => p.onZoom(p.zoom / 1.25)} title="Zoom out">
        −
      </button>
      <span className={styles.zoomLabel}>{Math.round(p.zoom * 100)}%</span>
      <button className={styles.navBtn} onClick={() => p.onZoom(p.zoom * 1.25)} title="Zoom in">
        +
      </button>
      <button className={styles.navBtn} onClick={p.onToggleFind} title="Find (Ctrl+F)">
        Find
      </button>
      <button
        className={styles.navBtn}
        onClick={p.onSettings}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>
    </header>
  )
})
