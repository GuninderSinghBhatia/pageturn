import type { Book } from '@shared/types'
import { displayTitle } from './displayTitle'
import styles from './LibraryView.module.css'

type Props = {
  book: Book
  onOpen(): void
  onRelocate(): void
  onContextMenu(e: React.MouseEvent): void
}

export function BookCard({ book, onOpen, onRelocate, onContextMenu }: Props): React.JSX.Element {
  const title = displayTitle(book)
  const progress =
    book.numPages && book.numPages > 0 ? Math.round((book.lastPage / book.numPages) * 100) : null

  return (
    <div
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
          <span className={styles.placeholder}>{title}</span>
        )}
      </button>
      <div className={styles.meta}>
        <span className={styles.title} data-testid="book-title" title={title}>
          {title}
        </span>
        {book.author && <span className={styles.author}>{book.author}</span>}
        <div className={styles.row}>
          {progress !== null && <span className={styles.progress}>{progress}%</span>}
          {book.missing && (
            <>
              <span className={styles.badge}>Missing</span>
              <button className={styles.link} onClick={onRelocate}>
                Relocate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
