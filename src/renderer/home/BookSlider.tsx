import { useRef } from 'react'
import type { Book } from '@shared/types'
import { displayTitle } from '../library/displayTitle'
import styles from './Slider.module.css'

const CARD_W = 190 // px at rest; the focused cover scales up
const GAP = 26
const VISIBLE = 3 // covers shown on each side of the focused one
const WHEEL_MS = 220

type Props = {
  books: Book[]
  focus: number
  onFocus(i: number): void
  onOpen(book: Book): void
  onContextMenu(book: Book, e: React.MouseEvent): void
}

/** Size/position/dim for a cover `offset` places away from the focused one. */
function look(offset: number): React.CSSProperties {
  const d = Math.abs(offset)
  const scale = d === 0 ? 1.18 : d === 1 ? 0.92 : 0.82
  const x = offset * (CARD_W + GAP) + Math.sign(offset) * (d === 0 ? 0 : 22) // room for the big one
  return {
    transform: `translateX(calc(-50% + ${x}px)) scale(${scale})`,
    zIndex: 20 - d,
    opacity: d > VISIBLE ? 0 : d === 0 ? 1 : d === 1 ? 0.78 : 0.5,
    filter: d === 0 ? 'none' : `brightness(${d === 1 ? 0.75 : 0.6})`,
    pointerEvents: d > VISIBLE ? 'none' : undefined
  }
}

const Heart = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
      fill="currentColor"
    />
  </svg>
)

/** Covers in a row; the focused one is big in the middle, the rest shrink and dim to the sides. */
export function BookSlider({
  books,
  focus,
  onFocus,
  onOpen,
  onContextMenu
}: Props): React.JSX.Element {
  const lastWheel = useRef(0)
  return (
    <div
      className={styles.track}
      style={{ height: Math.round(CARD_W * 1.5 * 1.18) + 40 }}
      onWheel={(e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (Math.abs(delta) < 4 || e.timeStamp - lastWheel.current < WHEEL_MS) return
        lastWheel.current = e.timeStamp
        onFocus(Math.min(books.length - 1, Math.max(0, focus + Math.sign(delta))))
      }}
    >
      {books.map((b, i) => {
        const offset = i - focus
        const title = displayTitle(b)
        const focused = offset === 0
        return (
          <article
            key={b.id}
            className={`${styles.card} ${focused ? styles.focused : ''} ${b.missing ? styles.missing : ''}`}
            style={{ width: CARD_W, ...look(offset) }}
            data-testid="book-card"
            aria-current={focused}
            onContextMenu={(e) => onContextMenu(b, e)}
          >
            <button
              className={styles.cover}
              aria-label={`Open ${title}`}
              tabIndex={focused ? 0 : -1}
              onClick={() => (focused ? onOpen(b) : onFocus(i))}
            >
              {b.thumbnailUrl ? (
                <img src={b.thumbnailUrl} alt="" draggable={false} />
              ) : (
                <span className={styles.coverTitle}>{title}</span>
              )}
              {b.liked && (
                <span className={styles.likedBadge} aria-hidden="true">
                  <Heart />
                </span>
              )}
              {focused && (
                <span className={styles.play} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24">
                    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                  </svg>
                </span>
              )}
            </button>
            <span className={styles.srOnly} data-testid="book-title">
              {title}
            </span>
          </article>
        )
      })}
    </div>
  )
}
