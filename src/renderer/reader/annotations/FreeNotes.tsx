import { useEffect, useRef } from 'react'
import type { Note } from '@shared/types'
import { useAnnotationStore } from '../../stores/annotationStore'
import { NotePopover } from './NotePopover'
import { useOverlayUi } from './uiStore'
import styles from './Annotations.module.css'

type Props = { page: number; notes: Note[]; width: number; height: number }

/** Sticky-note icons placed on a page, plus the editor for the one being edited. */
export function FreeNotes({ page, notes, width, height }: Props): React.JSX.Element {
  const open = useOverlayUi((s) => (s.openNote?.page === page ? s.openNote : null))
  const popRef = useRef<HTMLDivElement>(null)
  const editing = open?.id ? notes.find((n) => n.id === open.id) : undefined

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent): void => {
      if (!popRef.current?.contains(e.target as Node)) useOverlayUi.getState().closeAll()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  return (
    <>
      {notes.map((n) => (
        <button
          key={n.id}
          className={styles.sticky}
          data-no-turn
          aria-label={`Note: ${n.body.slice(0, 40)}`}
          title={n.body}
          style={{ left: n.anchor.point!.x * width, top: n.anchor.point!.y * height }}
          onClick={() =>
            useOverlayUi.getState().openNoteAt({ page, point: n.anchor.point!, id: n.id })
          }
        >
          ✎
        </button>
      ))}
      {open && (
        <div
          ref={popRef}
          className={styles.popover}
          role="dialog"
          aria-label="Note"
          data-no-turn
          style={{ left: open.point.x * width, top: open.point.y * height }}
        >
          <NotePopover
            key={`${open.point.x},${open.point.y}`} // stable across the first save (keeps focus)
            note={editing ?? null}
            onSave={(body) => {
              const saved = useAnnotationStore
                .getState()
                .saveNote({ id: open.id, page, anchor: { point: open.point }, body })
              // Later saves update this note instead of creating another.
              if (!open.id && useOverlayUi.getState().openNote) {
                useOverlayUi.getState().openNoteAt({ ...open, id: saved.id })
              }
            }}
            onDelete={
              editing
                ? () => {
                    useAnnotationStore.getState().deleteNote(editing.id)
                    useOverlayUi.getState().closeAll()
                  }
                : undefined
            }
            onClose={() => useOverlayUi.getState().closeAll()}
          />
        </div>
      )}
    </>
  )
}
