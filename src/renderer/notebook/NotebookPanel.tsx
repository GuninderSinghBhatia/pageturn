import { useMemo, useState } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@shared/types'
import { HIGHLIGHT_HEX } from '../reader/annotations/draw'
import { useAnnotationStore } from '../stores/annotationStore'
import { useReaderStore } from '../stores/readerStore'
import { useToastStore } from '../stores/toastStore'
import {
  filterItems,
  groupItems,
  toItems,
  type NotebookFilter,
  type NotebookItem,
  type NotebookKind
} from './notebookModel'
import { useNotebookStore } from './notebookStore'
import styles from './Notebook.module.css'

const KINDS: [NotebookKind, string][] = [
  ['highlight', 'Highlights'],
  ['note', 'Notes'],
  ['bookmark', 'Bookmarks'],
  ['ink', 'Ink']
]
const ICON: Record<NotebookKind, string> = { highlight: '▍', note: '📝', bookmark: '🔖', ink: '✎' }
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

/** Left drawer listing this book's highlights, notes, bookmarks and ink, with export. */
export function NotebookPanel({ bookId }: { bookId: string }): React.JSX.Element | null {
  const open = useNotebookStore((s) => s.open)
  const close = useNotebookStore((s) => s.close)
  const highlights = useAnnotationStore((s) => s.highlights)
  const notes = useAnnotationStore((s) => s.notes)
  const bookmarks = useAnnotationStore((s) => s.bookmarks)
  const ink = useAnnotationStore((s) => s.ink)
  const [filter, setFilter] = useState<NotebookFilter>({
    query: '',
    kinds: new Set(),
    colors: new Set(),
    groupBy: 'page'
  })

  const items = useMemo(
    () => toItems({ highlights, notes, bookmarks, ink }),
    [highlights, notes, bookmarks, ink]
  )
  const groups = useMemo(
    () => groupItems(filterItems(items, filter), filter.groupBy),
    [items, filter]
  )
  if (!open) return null

  const jump = (it: NotebookItem): void => {
    useReaderStore.getState().goTo(it.page)
    if (it.kind === 'highlight') useReaderStore.getState().pulse(it.id)
  }

  return (
    <aside className={styles.panel} aria-label="Notebook" data-no-turn>
      <header className={styles.head}>
        <h2>Notebook</h2>
        <button className={styles.iconBtn} aria-label="Close notebook" onClick={close}>
          ×
        </button>
      </header>
      <div className={styles.actions}>
        <button
          className={styles.ghost}
          onClick={async () => {
            const r = await window.api.export.markdown(bookId)
            if (r.saved) useToastStore.getState().show('Notes exported')
          }}
        >
          Export Markdown
        </button>
        <button
          className={styles.ghost}
          onClick={async () => {
            await navigator.clipboard.writeText(await window.api.export.markdownText(bookId))
            useToastStore.getState().show('Copied')
          }}
        >
          Copy all
        </button>
      </div>
      <input
        className={styles.search}
        type="search"
        aria-label="Search notebook"
        placeholder="Search highlights and notes"
        value={filter.query}
        onChange={(e) => setFilter({ ...filter, query: e.target.value })}
      />
      <div className={styles.chips} role="group" aria-label="Kinds">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            className={styles.chip}
            aria-pressed={filter.kinds.has(k)}
            onClick={() => setFilter({ ...filter, kinds: toggleIn(filter.kinds, k) })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.chips} role="group" aria-label="Colours">
        {HIGHLIGHT_COLORS.map((c: HighlightColor) => (
          <button
            key={c}
            className={styles.chip}
            aria-pressed={filter.colors.has(c)}
            aria-label={cap(c)}
            onClick={() => setFilter({ ...filter, colors: toggleIn(filter.colors, c) })}
          >
            <i className={styles.dot} style={{ background: HIGHLIGHT_HEX[c] }} aria-hidden="true" />
            {cap(c)}
          </button>
        ))}
      </div>
      <div className={styles.group} role="radiogroup" aria-label="Group by">
        {(['page', 'color'] as const).map((g) => (
          <label key={g} className={styles.radio}>
            <input
              type="radio"
              name="notebook-group"
              checked={filter.groupBy === g}
              onChange={() => setFilter({ ...filter, groupBy: g })}
            />
            By {g === 'page' ? 'page' : 'colour'}
          </label>
        ))}
      </div>

      <div className={styles.list}>
        {groups.length === 0 && (
          <p className={styles.empty}>
            {items.length === 0 ? 'No highlights or notes in this book yet.' : 'Nothing matches.'}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.key}>
            <h3 className={styles.groupHead}>{g.key}</h3>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <button className={styles.item} onClick={() => jump(it)}>
                    <span
                      className={styles.kind}
                      style={it.color ? { color: HIGHLIGHT_HEX[it.color] } : undefined}
                      aria-hidden="true"
                    >
                      {ICON[it.kind]}
                    </span>
                    <span className={styles.itemText}>
                      <span className={it.kind === 'highlight' ? styles.quote : undefined}>
                        {it.text}
                      </span>
                      {it.noteText && <span className={styles.note}>{it.noteText}</span>}
                    </span>
                    <span className={styles.page}>p. {it.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}
