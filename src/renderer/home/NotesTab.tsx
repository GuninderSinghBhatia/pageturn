import { useEffect, useState } from 'react'
import type { NotesGroup } from '@shared/ipc'
import { useNav } from '../app/nav'
import { displayTitle } from '../library/displayTitle'
import styles from './Home.module.css'

const date = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Every note across the library, grouped by book; a note opens its book at its page. */
export function NotesTab(): React.JSX.Element {
  const [groups, setGroups] = useState<NotesGroup[] | null>(null)

  useEffect(() => {
    let live = true
    void window.api.annotations.listAllNotes().then((g) => live && setGroups(g))
    return () => {
      live = false
    }
  }, [])

  if (!groups) return <p className={styles.muted}>Loading notes…</p>
  if (groups.length === 0) {
    return (
      <div className={styles.emptyCard}>
        <h2>No notes yet</h2>
        <p>Select text in a book, right-click and choose “Make a note”. Your notes collect here.</p>
      </div>
    )
  }
  return (
    <div className={styles.notes}>
      {groups.map(({ book, notes }) => (
        <section key={book.id} className={styles.noteGroup} aria-label={displayTitle(book)}>
          <header className={styles.noteHead}>
            {book.thumbnailUrl ? (
              <img className={styles.noteCover} src={book.thumbnailUrl} alt="" />
            ) : (
              <span className={styles.noteCover} />
            )}
            <div>
              <h2>{displayTitle(book)}</h2>
              {book.author && <p className={styles.muted}>{book.author}</p>}
            </div>
          </header>
          <ul className={styles.noteList}>
            {notes.map(({ note, quote }) => (
              <li key={note.id}>
                <button
                  className={styles.noteItem}
                  onClick={() => useNav.getState().goReader(book.id, note.page)}
                >
                  {quote && <q className={styles.quote}>{quote}</q>}
                  <span className={styles.noteBody}>{note.body}</span>
                  <span className={styles.noteMeta}>
                    Page {note.page} · {date(note.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
