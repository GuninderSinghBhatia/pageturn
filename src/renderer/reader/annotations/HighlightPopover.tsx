import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, type Highlight } from '@shared/types'
import { useAnnotationStore } from '../../stores/annotationStore'
import { HIGHLIGHT_HEX } from './draw'
import { NotePopover } from './NotePopover'
import styles from './Annotations.module.css'

type Props = {
  highlight: Highlight
  at: { x: number; y: number } // CSS px within the page overlay
  onClose(): void
}

/** Actions for a clicked highlight: colour, note, copy, delete. Esc / outside click closes. */
export function HighlightPopover({ highlight, at, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const note = useAnnotationStore((s) => (highlight.noteId ? s.notes[highlight.noteId] : undefined))
  const [editing, setEditing] = useState(!!note)
  const store = useAnnotationStore.getState

  useEffect(() => {
    const outside = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={styles.popover}
      role="dialog"
      aria-label="Highlight"
      data-no-turn
      style={{ left: at.x, top: at.y }}
    >
      <div className={styles.popoverRow}>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            className={styles.swatch}
            style={{ background: HIGHLIGHT_HEX[c] }}
            aria-label={c}
            aria-pressed={c === highlight.color}
            onClick={() => store().setHighlightColor(highlight.id, c)}
          />
        ))}
      </div>
      {editing ? (
        <NotePopover
          note={note ?? null}
          onSave={(body) =>
            store().saveNote({
              id: note?.id,
              page: highlight.page,
              anchor: { highlightId: highlight.id },
              body
            })
          }
          onDelete={note ? () => store().deleteNote(note.id) : undefined}
          onClose={onClose}
        />
      ) : null}
      <div className={styles.popoverRow}>
        {!editing && (
          <button className={styles.textBtn} onClick={() => setEditing(true)}>
            Add note
          </button>
        )}
        <button
          className={styles.textBtn}
          onClick={() => void navigator.clipboard.writeText(highlight.text)}
        >
          Copy
        </button>
        <button
          className={styles.textBtn}
          aria-label="Delete highlight"
          onClick={() => {
            store().deleteHighlight(highlight.id)
            onClose()
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
