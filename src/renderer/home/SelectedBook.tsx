import { useEffect, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { useNav } from '../app/nav'
import { displayTitle } from '../library/displayTitle'
import styles from './Slider.module.css'

type Props = {
  book: Book
  canPrev: boolean
  canNext: boolean
  onPrev(): void
  onNext(): void
  onOpen(): void
  onLike(liked: boolean): void
  onRelocate(): void
  onRemove(): void
}

const fmt = (ms: number | null): string =>
  ms
    ? new Date(ms).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : '—'

const Chevron = ({ dir }: { dir: 1 | -1 }): React.JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={dir === 1 ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
  </svg>
)

/** Title, facts and actions for the focused book, with the slider's arrows. */
export function SelectedBook(p: Props): React.JSX.Element {
  const { book } = p
  const title = displayTitle(book)
  const total = book.numPages ?? 0
  const page = Math.min(Math.max(1, book.lastPage), total || 1)
  const pct = total > 0 ? Math.round((page / total) * 100) : 0
  const started = book.lastPage > 1
  const [details, setDetails] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!details) return
    const close = (e: Event): void => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !panelRef.current?.contains(e.target as Node)
      ) {
        setDetails(false)
      }
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close)
    }
  }, [details])

  const meta = [
    book.author,
    total ? `${total} ${total === 1 ? 'page' : 'pages'}` : null,
    total ? `Page ${page} (${pct}%)` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className={styles.selected} aria-label="Selected book">
      {/* key: the text slides in again whenever the focused book changes */}
      <div key={book.id} className={styles.selectedText}>
        <h2 className={styles.selectedTitle}>{title}</h2>
        <p className={styles.selectedMeta}>
          {book.missing ? <span className={styles.badge}>Missing</span> : meta}
        </p>
      </div>
      <div className={styles.actions}>
        <div className={styles.actionGroup}>
          {book.missing ? (
            <button className={styles.primary} onClick={p.onRelocate}>
              Find file…
            </button>
          ) : (
            <button className={styles.primary} onClick={p.onOpen}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
              </svg>
              {started ? 'Continue reading' : 'Start reading'}
            </button>
          )}
          <button
            className={`${styles.square} ${book.liked ? styles.likedBtn : ''}`}
            aria-label={`Like ${title}`}
            aria-pressed={book.liked}
            onClick={() => p.onLike(!book.liked)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
                fill={book.liked ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
          <button className={styles.ghost} onClick={() => useNav.getState().setHomeTab('notes')}>
            Notes
          </button>
          <div className={styles.detailsWrap}>
            <button
              className={styles.ghost}
              aria-expanded={details}
              onClick={() => setDetails((d) => !d)}
            >
              Details
            </button>
            {details && (
              <div
                ref={panelRef}
                className={styles.detailsPanel}
                role="dialog"
                aria-label="Book details"
              >
                <dl>
                  <dt>Pages</dt>
                  <dd>{total || '—'}</dd>
                  <dt>Progress</dt>
                  <dd>{total ? `Page ${page} of ${total} (${pct}%)` : '—'}</dd>
                  <dt>Added</dt>
                  <dd>{fmt(book.addedAt)}</dd>
                  <dt>Last opened</dt>
                  <dd>{fmt(book.lastOpenedAt)}</dd>
                  <dt>File</dt>
                  <dd className={styles.path}>{book.path}</dd>
                </dl>
                <button
                  className={styles.danger}
                  onClick={() => {
                    setDetails(false)
                    p.onRemove()
                  }}
                >
                  Remove from library
                </button>
              </div>
            )}
          </div>
        </div>
        <div className={styles.actionGroup}>
          <button
            className={styles.arrow}
            aria-label="Previous book"
            disabled={!p.canPrev}
            onClick={p.onPrev}
          >
            <Chevron dir={-1} />
          </button>
          <button
            className={`${styles.arrow} ${styles.arrowNext}`}
            aria-label="Next book"
            disabled={!p.canNext}
            onClick={p.onNext}
          >
            <Chevron dir={1} />
          </button>
        </div>
      </div>
    </section>
  )
}
