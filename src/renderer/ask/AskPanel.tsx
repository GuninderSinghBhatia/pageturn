import { useEffect, useState } from 'react'
import type { RagAnswer, RagRelated } from '@shared/ipc'
import { useReaderStore } from '../stores/readerStore'
import { lastVisiblePage } from '../reader/layout'

/** Spoiler Shield limit: the last page on screen, not the first page of the spread. */
const readingLimit = (s: ReturnType<typeof useReaderStore.getState>): number =>
  s.doc ? lastVisiblePage(s.page, s.doc.numPages, s.layout) : s.page
import { useAskStore } from './askStore'
import { splitCitations } from './citations'
import styles from './Ask.module.css'

type Result =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'answer'; answer: string; pages: number[]; related: RagRelated[] }
  | { kind: 'error'; message: string }

/** Left drawer: ask the indexed book a question; page citations jump the reader there. */
export function AskPanel(): React.JSX.Element | null {
  const open = useAskStore((s) => s.open)
  const close = useAskStore((s) => s.close)
  const readingPage = useReaderStore(readingLimit)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<Result>({ kind: 'idle' })

  /** Shows `label` in the input, then the call's answer (or its failure) in the body. */
  const run = async (label: string, call: Promise<RagAnswer>): Promise<void> => {
    setQuestion(label)
    setResult({ kind: 'loading' })
    const r = await call
    setResult(
      r.ok
        ? { kind: 'answer', answer: r.answer, pages: r.pages, related: r.related ?? [] }
        : { kind: 'error', message: r.error }
    )
  }

  // "Who is this?" from the selection menu: look the name up as soon as the drawer opens.
  useEffect(
    () =>
      useAskStore.subscribe((s) => {
        if (!s.pendingName) return
        const name = s.pendingName
        s.clearPendingName()
        void run(
          `Who is ${name}?`,
          window.api.rag.who(
            name,
            readingLimit(useReaderStore.getState()),
            useReaderStore.getState().bookId ?? undefined
          )
        )
      }),
    []
  )

  if (!open) return null

  const jump = (page: number): void => useReaderStore.getState().goTo(page)

  const submit = async (): Promise<void> => {
    const q = question.trim()
    if (!q || result.kind === 'loading') return
    await run(
      q,
      window.api.rag.ask(
        q,
        readingLimit(useReaderStore.getState()),
        useReaderStore.getState().bookId ?? undefined
      )
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
      <p className={styles.shield}>
        <span aria-hidden="true">🛡</span> Spoiler Shield: answers only use pages 1–{readingPage}
      </p>
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
            {result.related.length > 0 && (
              <div className={styles.related}>
                <span className={styles.hint}>Connected in the book:</span>
                <ul>
                  {result.related.map((r) => (
                    <li key={`${r.direction}-${r.relation}-${r.name}`}>
                      <span className={styles.hint}>
                        {r.direction === 'out' ? r.relation : `← ${r.relation}`}
                      </span>{' '}
                      <button
                        className={styles.term}
                        onClick={() => useAskStore.getState().askWho(r.name)}
                      >
                        {r.name}
                      </button>
                      {r.pages.slice(0, 3).map((p) => (
                        <button key={p} className={styles.cite} onClick={() => jump(p)}>
                          p. {p}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
