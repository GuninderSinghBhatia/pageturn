import { useEffect, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { displayTitle } from '../library/displayTitle'
import styles from './Slider.module.css'

const SPINE_W = 56 // px, a book standing on the shelf
const COVER_W = 250 // px, the focused book turned to face you
const COVER_H = 350
const GAP = 6
const FAR = 16 // books further than this from the focus are hidden
const WHEEL_MS = 220

type Props = {
  books: Book[]
  focus: number
  onFocus(i: number): void
  onOpen(book: Book): void
  onContextMenu(book: Book, e: React.MouseEvent): void
}

const hash = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

type Tone = { bg: string; fg: string }

/** Number-tab colours, cycled along the shelf like the labels on a real set of books. */
const TABS: Tone[] = [
  { bg: '#3f7ad6', fg: '#fff' },
  { bg: '#b9c2d3', fg: '#1b1b1b' },
  { bg: '#d9262f', fg: '#fff' },
  { bg: '#f4f1ea', fg: '#c0392b' },
  { bg: '#c6e03a', fg: '#1b1b1b' },
  { bg: '#e0a82a', fg: '#fff' },
  { bg: '#f4f1ea', fg: '#2f6fd0' },
  { bg: '#2f6fd0', fg: '#fff' },
  { bg: '#7a7a2a', fg: '#fff' }
]

/** Muted spine colour from the title, used until (or instead of) the cover's own colour. */
const fallbackTone = (key: string): Tone => ({
  bg: `hsl(${hash(key) % 360} 38% 34%)`,
  fg: '#fff'
})

/** Average colour of a cover, so each spine matches its book. Falls back if the image can't be read. */
function useSpineTone(book: Book): Tone {
  const [tone, setTone] = useState<Tone>(() => fallbackTone(book.id))
  const url = book.thumbnailUrl
  useEffect(() => {
    if (!url) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 8
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 8, 8)
        const d = ctx.getImageData(0, 0, 8, 8).data
        let r = 0
        let g = 0
        let b = 0
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
        }
        const n = d.length / 4
        r = Math.round(r / n)
        g = Math.round(g / n)
        b = Math.round(b / n)
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (alive) setTone({ bg: `rgb(${r} ${g} ${b})`, fg: lum > 0.62 ? '#1b1b1b' : '#fff' })
      } catch {
        /* tainted canvas: keep the fallback colour */
      }
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url])
  return tone
}

const Heart = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
      fill="currentColor"
    />
  </svg>
)

type BookProps = {
  book: Book
  index: number
  offset: number
  onFocus(): void
  onOpen(): void
  onContextMenu(e: React.MouseEvent): void
}

function ShelfBook({
  book,
  index,
  offset,
  onFocus,
  onOpen,
  onContextMenu
}: BookProps): React.JSX.Element {
  const title = displayTitle(book)
  const focused = offset === 0
  const tone = useSpineTone(book)
  // Spines differ slightly in height, like real books.
  const spineH = COVER_H - 8 - (hash(book.id) % 10)
  const x =
    offset === 0
      ? 0
      : Math.sign(offset) *
        (COVER_W / 2 + GAP + SPINE_W / 2 + (Math.abs(offset) - 1) * (SPINE_W + GAP))
  const far = Math.abs(offset) > FAR

  return (
    <article
      className={`${styles.book} ${focused ? styles.focused : ''} ${book.missing ? styles.missing : ''}`}
      style={{
        width: focused ? COVER_W : SPINE_W,
        height: focused ? COVER_H : spineH,
        transform: `translateX(calc(-50% + ${x}px))`,
        zIndex: focused ? 30 : 20 - Math.abs(offset),
        opacity: far ? 0 : 1,
        pointerEvents: far ? 'none' : undefined
      }}
      data-testid="book-card"
      aria-current={focused}
      onContextMenu={onContextMenu}
    >
      <button
        className={styles.bookBtn}
        aria-label={`Open ${title}`}
        tabIndex={focused ? 0 : -1}
        onClick={() => (focused ? onOpen() : onFocus())}
      >
        {/* Spine: what you see while it stands on the shelf. */}
        <span
          className={styles.spine}
          style={{ background: tone.bg, color: tone.fg }}
          aria-hidden="true"
        >
          <span
            className={styles.spineTab}
            style={{
              background: TABS[index % TABS.length].bg,
              color: TABS[index % TABS.length].fg
            }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={styles.spineTitle}>{title}</span>
          {book.author && <span className={styles.spineAuthor}>{book.author}</span>}
        </span>
        {/* Cover: turned toward you when focused. */}
        <span className={styles.face} aria-hidden="true">
          {book.thumbnailUrl ? (
            <img src={book.thumbnailUrl} alt="" draggable={false} />
          ) : (
            <span className={styles.coverTitle} style={{ background: tone.bg, color: tone.fg }}>
              {title}
            </span>
          )}
          {book.liked && (
            <span className={styles.likedBadge}>
              <Heart />
            </span>
          )}
        </span>
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
}

/** A shelf of book spines; the focused one turns to show its cover. */
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
      style={{ height: COVER_H + 60 }}
      onWheel={(e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (Math.abs(delta) < 4 || e.timeStamp - lastWheel.current < WHEEL_MS) return
        lastWheel.current = e.timeStamp
        onFocus(Math.min(books.length - 1, Math.max(0, focus + Math.sign(delta))))
      }}
    >
      {books.map((b, i) => (
        <ShelfBook
          key={b.id}
          book={b}
          index={i}
          offset={i - focus}
          onFocus={() => onFocus(i)}
          onOpen={() => onOpen(b)}
          onContextMenu={(e) => onContextMenu(b, e)}
        />
      ))}
      <div className={styles.plank} aria-hidden="true" />
    </div>
  )
}
