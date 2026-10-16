import { useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import styles from './Annotations.module.css'

const AUTOSAVE_MS = 500

type Props = {
  note: Note | null // null = a new note
  onSave(body: string): void
  onDelete?(): void
  onClose(): void
}

/** Note editor: saves 500 ms after typing stops and on blur; Esc closes. */
export function NotePopover({ note, onSave, onDelete, onClose }: Props): React.JSX.Element {
  const [body, setBody] = useState(note?.body ?? '')
  const saved = useRef(note?.body ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(body)

  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const text = latest.current
    if (text === saved.current || (!note && text.trim() === '')) return
    saved.current = text
    onSave(text)
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  useEffect(() => () => flushRef.current(), []) // never lose a pending edit on unmount

  return (
    <div className={styles.note}>
      <textarea
        aria-label="Note"
        className={styles.noteText}
        autoFocus
        placeholder="Write a note…"
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          latest.current = e.target.value
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => flushRef.current(), AUTOSAVE_MS)
        }}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault()
            e.stopPropagation()
            flush()
            onClose()
          }
        }}
      />
      {onDelete && note && (
        <button className={styles.textBtn} onClick={onDelete}>
          Delete note
        </button>
      )}
    </div>
  )
}
