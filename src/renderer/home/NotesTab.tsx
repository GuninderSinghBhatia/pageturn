import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NotesGroup } from '@shared/ipc'
import { NOTE_TAGS, type Book, type Note, type NoteTag } from '@shared/types'
import { useNav } from '../app/nav'
import { displayTitle } from '../library/displayTitle'
import { useLibraryStore } from '../stores/libraryStore'
import styles from './Notes.module.css'

type Item = { note: Note; quote: string | null; book: Book }

const TAG_LABEL: Record<NoteTag, string> = {
  important: 'important',
  idea: 'idea',
  review: 'review'
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
/** "2 days ago", "yesterday", "just now". */
function ago(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000)
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year']
  ]
  let v = s
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size)
      return unit === 'second' && Math.abs(v) < 45 ? 'just now' : rtf.format(Math.round(v), unit)
    v /= size
  }
  return ''
}

/** All notes, newest first, each with its book. */
const flatten = (groups: NotesGroup[]): Item[] =>
  groups
    .flatMap(({ book, notes }) => notes.map((n) => ({ ...n, book })))
    .sort((a, b) => b.note.updatedAt - a.note.updatedAt)

/** First line of a note is its title; the rest is the body. */
function split(body: string): { title: string; rest: string } {
  const text = body.trim()
  if (!text) return { title: 'Untitled note', rest: '' }
  const nl = text.indexOf('\n')
  const first = (nl < 0 ? text : text.slice(0, nl)).trim()
  const rest = nl < 0 ? '' : text.slice(nl + 1).trim()
  return first.length > 64
    ? { title: `${first.slice(0, 61).trimEnd()}…`, rest: text }
    : { title: first, rest }
}

const PencilIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Every note across the library as a grid of cards: open, edit, tag, delete. */
export function NotesTab({ query = '' }: { query?: string }): React.JSX.Element {
  const books = useLibraryStore((s) => s.books)
  const [items, setItems] = useState<Item[] | null>(null)
  const [tag, setTag] = useState<NoteTag | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setItems(flatten(await window.api.annotations.listAllNotes()))
  }, [])

  useEffect(() => {
    let live = true
    void window.api.annotations.listAllNotes().then((groups) => live && setItems(flatten(groups)))
    return () => {
      live = false
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter(
      (it) =>
        (!tag || it.note.tags?.includes(tag)) &&
        (!q ||
          it.note.body.toLowerCase().includes(q) ||
          (it.quote ?? '').toLowerCase().includes(q) ||
          displayTitle(it.book).toLowerCase().includes(q))
    )
  }, [items, tag, query])

  if (!items) return <p className={styles.muted}>Loading notes…</p>

  if (items.length === 0) {
    const last = [...books].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]
    return (
      <div className={styles.empty}>
        <p>No notes yet. Select text in a book, right-click and choose “Make a note”.</p>
        <button
          className={styles.primary}
          disabled={!last}
          title={last ? `Open ${displayTitle(last)}` : 'Add a book first'}
          onClick={() => last && useNav.getState().goReader(last.id, last.lastPage)}
        >
          New note
        </button>
      </div>
    )
  }

  const count = (t: NoteTag): number => items.filter((it) => it.note.tags?.includes(t)).length

  return (
    <div className={styles.wrap}>
      <div className={styles.filters} role="group" aria-label="Filter by tag">
        <button className={styles.filter} aria-pressed={tag === null} onClick={() => setTag(null)}>
          All <span>{items.length}</span>
        </button>
        {NOTE_TAGS.map((t) => (
          <button
            key={t}
            className={styles.filter}
            aria-pressed={tag === t}
            onClick={() => setTag(tag === t ? null : t)}
          >
            <i className={`${styles.dot} ${styles[t]}`} aria-hidden="true" />
            {TAG_LABEL[t]} <span>{count(t)}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={styles.muted}>No notes match.</p>
      ) : (
        <div className={styles.grid}>
          {visible.map((it) => (
            <NoteCard
              key={it.note.id}
              item={it}
              editing={editing === it.note.id}
              onEdit={(on) => setEditing(on ? it.note.id : null)}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({
  item,
  editing,
  onEdit,
  onChanged
}: {
  item: Item
  editing: boolean
  onEdit(on: boolean): void
  onChanged(): Promise<void>
}): React.JSX.Element {
  const { note, quote, book } = item
  const { title, rest } = split(note.body)
  const [draft, setDraft] = useState(note.body)
  const [tags, setTags] = useState<NoteTag[]>(note.tags ?? [])
  const [confirming, setConfirming] = useState(false)
  const total = book.numPages ?? 0
  const pct = total ? Math.round((Math.min(book.lastPage, total) / total) * 100) : 0
  const open = (): void => useNav.getState().goReader(book.id, note.page)
  const meta = [displayTitle(book), book.author].filter(Boolean).join(' · ')

  const save = async (): Promise<void> => {
    if (draft !== note.body) {
      await window.api.annotations.upsertNote({ ...note, body: draft, updatedAt: Date.now() })
    }
    const before = note.tags ?? []
    if (tags.length !== before.length || tags.some((t) => !before.includes(t))) {
      await window.api.annotations.setNoteTags(note.id, tags)
    }
    onEdit(false)
    await onChanged()
  }

  return (
    <article
      className={`${styles.card} ${editing ? styles.selected : ''}`}
      aria-label={`Note: ${title}`}
      onClick={(e) => {
        // A click on the card body opens the book; buttons and fields handle their own.
        if (!editing && !(e.target as Element).closest('button, textarea, a')) open()
      }}
    >
      <header className={styles.head}>
        <span className={styles.icon}>
          <PencilIcon />
        </span>
        <button className={styles.title} onClick={open} title={`Open page ${note.page}`}>
          {title}
        </button>
        <span className={styles.badge}>p. {note.page}</span>
      </header>
      <div className={styles.meta}>{meta}</div>
      {quote && <blockquote className={styles.quote}>“{quote}”</blockquote>}

      {editing ? (
        <>
          <textarea
            className={styles.editor}
            aria-label="Note text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onEdit(false)
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
            }}
          />
          <div className={styles.tags} role="group" aria-label="Tags">
            {NOTE_TAGS.map((t) => (
              <button
                key={t}
                className={styles.tag}
                aria-pressed={tags.includes(t)}
                onClick={() =>
                  setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
                }
              >
                <i className={`${styles.dot} ${styles[t]}`} aria-hidden="true" />
                {TAG_LABEL[t]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {rest && <p className={styles.body}>{rest}</p>}
          {!!note.tags?.length && (
            <div className={styles.tags}>
              {note.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  <i className={`${styles.dot} ${styles[t]}`} aria-hidden="true" />
                  {TAG_LABEL[t]}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {total > 0 && (
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Reading progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          title={`Read ${pct}% of the book`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      <footer className={styles.foot}>
        <time dateTime={new Date(note.updatedAt).toISOString()}>{ago(note.updatedAt)}</time>
        <span className={styles.actions}>
          {editing ? (
            <>
              <button onClick={() => onEdit(false)}>Cancel</button>
              <button className={styles.save} onClick={() => void save()}>
                Save
              </button>
            </>
          ) : confirming ? (
            <>
              <span>Delete note?</span>
              <button
                className={styles.danger}
                onClick={async () => {
                  await window.api.annotations.deleteNote(note.id)
                  await onChanged()
                }}
              >
                Delete
              </button>
              <button onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setDraft(note.body)
                  setTags(note.tags ?? [])
                  onEdit(true)
                }}
              >
                Edit
              </button>
              <span aria-hidden="true">·</span>
              <button onClick={() => setConfirming(true)}>Delete</button>
            </>
          )}
        </span>
      </footer>
    </article>
  )
}
