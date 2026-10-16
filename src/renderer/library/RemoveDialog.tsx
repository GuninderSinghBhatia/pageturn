import { useEffect, useRef, useState } from 'react'
import modal from '../reader/Reader.module.css'

type Props = { title: string; onConfirm(deleteAnnotations: boolean): void; onCancel(): void }

/** Confirms removing a book; annotations are kept (for a later re-import) unless ticked. */
export function RemoveDialog({ title, onConfirm, onCancel }: Props): React.JSX.Element {
  const [deleteAnnotations, setDeleteAnnotations] = useState(false)
  const removeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => removeRef.current?.focus(), [])

  return (
    <div className={modal.modalBackdrop} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form
        className={modal.modal}
        role="dialog"
        aria-label="Remove book"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(deleteAnnotations)
        }}
      >
        <h2>Remove “{title}” from the library?</h2>
        <p style={{ margin: 0 }}>The PDF file itself is not deleted.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={deleteAnnotations}
            onChange={(e) => setDeleteAnnotations(e.target.checked)}
          />
          Also delete highlights, notes and drawings
        </label>
        <div className={modal.modalActions}>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button ref={removeRef} type="submit" className={modal.primary}>
            Remove
          </button>
        </div>
      </form>
    </div>
  )
}
