import type { Book } from '@shared/types'
import { displayTitle } from '../library/displayTitle'
import styles from './Home.module.css'

type Props = {
  book: Book
  onOpen(): void
  onRelocate(): void
  onLike(liked: boolean): void
  onContextMenu(e: React.MouseEvent): void
}

const Heart = ({ filled }: { filled: boolean }): React.JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
)

/** Cover (click to open at the last page read) with title, author, like and progress. */
export function BookCard({
  book,
  onOpen,
  onRelocate,
  onLike,
  onContextMenu
}: Props): React.JSX.Element {
  const title = displayTitle(book)
  const total = book.numPages ?? 0
  const page = Math.min(Math.max(1, book.lastPage), total || 1)
  const pct = total > 0 ? Math.round((page / total) * 100) : 0

  return (
    <article
      className={`${styles.card} ${book.missing ? styles.missing : ''}`}
      data-testid="book-card"
      onContextMenu={onContextMenu}
    >
      <button
        className={styles.cover}
        onClick={book.missing ? onRelocate : onOpen}
        aria-label={book.missing ? `${title} (missing)` : `Open ${title}`}
        title={book.missing ? 'File not found — click to relocate' : `Open ${title}`}
      >
        {book.thumbnailUrl ? (
          <img src={book.thumbnailUrl} alt="" draggable={false} />
        ) : (
          <span className={styles.coverTitle}>{title}</span>
        )}
      </button>
      <div className={styles.details}>
        <h3 className={styles.title} data-testid="book-title" title={title}>
          {title}
        </h3>
        <div className={styles.authorRow}>
          <span className={styles.author}>{book.author ?? ' '}</span>
          <button
            className={`${styles.like} ${book.liked ? styles.liked : ''}`}
            aria-label={`Like ${title}`}
            aria-pressed={book.liked}
            onClick={() => onLike(!book.liked)}
          >
            <Heart filled={book.liked} />
          </button>
        </div>
        {book.missing ? (
          <div className={styles.missingRow}>
            <span className={styles.badge}>Missing</span>
            <button className={styles.link} onClick={onRelocate}>
              Relocate
            </button>
          </div>
        ) : total > 0 ? (
          <>
            <span className={styles.pages}>
              Page {page} / {total}
            </span>
            <div
              className={styles.progress}
              role="progressbar"
              aria-label={`${title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : null}
      </div>
    </article>
  )
}
