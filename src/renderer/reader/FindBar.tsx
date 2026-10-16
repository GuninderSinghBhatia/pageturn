import { useEffect, useRef, useState } from 'react'
import type { OpenedDoc } from './pdf/pdfService'
import toolbar from './chrome/Toolbar.module.css'
import styles from './Reader.module.css'

type Props = {
  doc: OpenedDoc
  visibleLast: number // highest page currently on screen
  onJump(page: number): void
  onClose(): void
  inline?: boolean // inside the reader toolbar pill
}

/** Results for one needle; a needle with no results object yet is still being searched. */
type Search = { needle: string; hitPages: number[]; count: number; done: boolean }

function countMatches(haystack: string, needle: string): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length))
    n++
  return n
}

/** Incremental, cancellable whole-book text search; Enter jumps to the next page with a hit. */
export function FindBar({ doc, visibleLast, onJump, onClose, inline }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Search | null>(null)
  const pendingJump = useRef(false)
  const visibleLastRef = useRef(visibleLast)
  const needle = query.trim().toLowerCase()
  const search: Search =
    results?.needle === needle ? results : { needle, hitPages: [], count: 0, done: !needle }
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    visibleLastRef.current = visibleLast
  }, [visibleLast])

  useEffect(() => {
    pendingJump.current = false
    if (!needle) return
    let cancelled = false
    const run = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 200)) // debounce typing
      const found: Search = { needle, hitPages: [], count: 0, done: false }
      for (let p = 1; p <= doc.numPages && !cancelled; p++) {
        const text = (await doc.getText(p))
          .map((t) => t.str)
          .join(' ')
          .toLowerCase()
        if (cancelled) return
        const n = countMatches(text, needle)
        if (n > 0) {
          found.hitPages = [...found.hitPages, p]
          found.count += n
          setResults({ ...found })
          if (pendingJump.current && p > visibleLastRef.current) {
            pendingJump.current = false
            onJump(p)
          }
        } else if (p % 25 === 0) setResults({ ...found })
      }
      if (cancelled) return
      setResults({ ...found, done: true })
      if (pendingJump.current && found.hitPages.length > 0) {
        pendingJump.current = false
        onJump(found.hitPages[0]) // wrap around
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // onJump intentionally excluded: restarting the search on every render would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, doc])

  const jumpNext = (): void => {
    const next = search.hitPages.find((p) => p > visibleLast) ?? search.hitPages[0]
    if (next !== undefined && (search.done || next > visibleLast)) onJump(next)
    else if (!search.done) pendingJump.current = true // wait for the next hit to arrive
  }

  return (
    <div className={inline ? toolbar.find : styles.findBar} role="search">
      <input
        ref={inputRef}
        data-testid="find-input"
        aria-label="Find in book"
        className={inline ? toolbar.findInput : styles.findInput}
        placeholder="Find in book"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') jumpNext()
          if (e.key === 'Escape') onClose()
        }}
      />
      <span className={inline ? toolbar.findCount : styles.findCount}>
        {needle &&
          `${search.count} match${search.count === 1 ? '' : 'es'} on ${search.hitPages.length} page${search.hitPages.length === 1 ? '' : 's'}${search.done ? '' : '…'}`}
      </span>
      {!inline && (
        <button className={styles.navBtn} onClick={onClose} aria-label="Close find">
          ✕
        </button>
      )}
    </div>
  )
}
