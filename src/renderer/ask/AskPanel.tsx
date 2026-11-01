import { useState } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useAskStore } from './askStore'
import { splitCitations } from './citations'
import styles from './Ask.module.css'

type Result =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'answer'; answer: string; pages: number[] }
  | { kind: 'error'; message: string }

/** Left drawer: ask the indexed book a question; page citations jump the reader there. */
export function AskPanel(): React.JSX.Element | null {
  const open = useAskStore((s) => s.open)
  const close = useAskStore((s) => s.close)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<Result>({ kind: 'idle' })
  if (!open) return null

  const jump = (page: number): void => useReaderStore.getState().goTo(page)

  const submit = async (): Promise<void> => {
    const q = question.trim()
    if (!q || result.kind === 'loading') return
    setResult({ kind: 'loading' })
    const r = await window.api.rag.ask(q, useReaderStore.getState().page)
    setResult(
      r.ok
        ? { kind: 'answer', answer: r.answer, pages: r.pages }
        : { kind: 'error', message: r.error }
    )
  }

  return (
    <aside className={styles.panel} aria-label="Ask the book" data-no-turn>
      <header className={styles.head}>
        <h2>Ask the book</h2>
        <button className={styles.iconBtn} aria-label="Close ask panel" onClick={close}>
          ×
        </button>
      </header>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          className={styles.input}
          aria-label="Question"
          placeholder="Ask something about the book…"
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          className={styles.ask}
          type="submit"
          disabled={!question.trim() || result.kind === 'loading'}
        >
          Ask
        </button>
      </form>
      <div className={styles.body} role="status" aria-live="polite">
        {result.kind === 'loading' && <p className={styles.hint}>Searching the book…</p>}
        {result.kind === 'error' && <p className={styles.error}>{result.message}</p>}
        {result.kind === 'answer' && (
          <>
            <p className={styles.answer}>
              {splitCitations(result.answer).map((part, i) =>
                'page' in part ? (
                  <button key={i} className={styles.cite} onClick={() => jump(part.page)}>
                    {part.text.replace(/[()]/g, '').trim()}
                  </button>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
            </p>
            {result.pages.length > 0 && (
              <div className={styles.sources}>
                <span className={styles.hint}>Passages used:</span>
                {result.pages.map((p) => (
                  <button key={p} className={styles.cite} onClick={() => jump(p)}>
                    p. {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
