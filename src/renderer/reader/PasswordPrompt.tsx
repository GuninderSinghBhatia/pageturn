import { useEffect, useRef, useState } from 'react'
import styles from './Reader.module.css'

type Props = { retry: boolean; onSubmit(password: string | null): void }

export function PasswordPrompt({ retry, onSubmit }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [retry])

  return (
    <div className={styles.modalBackdrop}>
      <form
        className={styles.modal}
        role="dialog"
        aria-label="Password required"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(value)
          setValue('')
        }}
      >
        <h2>This PDF is password-protected</h2>
        {retry && <p className={styles.modalError}>Incorrect password. Try again.</p>}
        <input
          ref={inputRef}
          type="password"
          data-testid="password-input"
          aria-label="Password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className={styles.modalActions}>
          <button type="button" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button type="submit" className={styles.primary}>
            Open
          </button>
        </div>
      </form>
    </div>
  )
}
