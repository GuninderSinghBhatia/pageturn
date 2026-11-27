import { useEffect, useState } from 'react'
import type { RagAnswer, RagRelated } from '@shared/ipc'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { lastVisiblePage } from '../reader/layout'
import { useAskStore } from './askStore'
import { splitCitations } from './citations'
import { IndexGate } from './IndexGate'
import styles from './Ask.module.css'

/** Spoiler Shield limit: the last page on screen, not the first page of the spread. */
const readingLimit = (s: ReturnType<typeof useReaderStore.getState>): number =>
  s.doc ? lastVisiblePage(s.page, s.doc.numPages, s.layout) : s.page

/** This book's Spoiler Shield: on, off, or null when the reader has not been asked yet. */
const shieldFor = (bookId: string | null, map: Record<string, boolean>): boolean | null =>
  bookId ? (map[bookId] ?? null) : true

/** The last page answers may use: where the reader is, or the whole book with the Shield off. */
function pageLimit(): number {
  const r = useReaderStore.getState()
  const on = shieldFor(r.bookId, useSettingsStore.getState().settings.spoilerShield) !== false
  return on ? readingLimit(r) : (r.doc?.numPages ?? r.page)
}

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
  const bookId = useReaderStore((s) => s.bookId)
  const shieldMap = useSettingsStore((s) => s.settings.spoilerShield)
  const setSettings = useSettingsStore((s) => s.set)
  const shield = shieldFor(bookId, shieldMap)
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

  /**
   * Looks up a name waiting from "Who is this?", once the book is indexed and its Shield is
   * decided.
   */
  const runPendingWho = (): void => {
    const { pendingName, clearPendingName, readyBook } = useAskStore.getState()
    const r = useReaderStore.getState()
    if (
      !pendingName ||
      (r.bookId && readyBook !== r.bookId) ||
      shieldFor(r.bookId, useSettingsStore.getState().settings.spoilerShield) === null
    )
      return
    clearPendingName()
    void run(
      `Who is ${pendingName}?`,
      window.api.rag.who(pendingName, pageLimit(), r.bookId ?? undefined)
    )
  }

  // "Who is this?" from the selection menu: look the name up as soon as the drawer opens
  // (after indexing and the Spoiler Shield question, the first time in a book). Runs on any
  // Ask-store change, including the book becoming ready.
  // runPendingWho reads the stores through getState() and only calls state setters, so one
  // subscription for the panel's life is enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => useAskStore.subscribe((s) => s.pendingName && runPendingWho()), [])

  /** Saves this book's Spoiler Shield choice. */
  const setShield = async (on: boolean): Promise<void> => {
    if (!bookId) return
    await setSettings({ spoilerShield: { ...shieldMap, [bookId]: on } })
    runPendingWho()
  }

  if (!open) return null

  const jump = (page: number): void => useReaderStore.getState().goTo(page)

  const submit = async (): Promise<void> => {
    const q = question.trim()
    if (!q || result.kind === 'loading') return
    await run(q, window.api.rag.ask(q, pageLimit(), useReaderStore.getState().bookId ?? undefined))
  }

  const askBody = (
    <>
      {shield === null ? (
        <div className={styles.shieldAsk} role="group" aria-labelledby="shield-ask-title">
          <h3 id="shield-ask-title">
            <span aria-hidden="true">🛡</span> Turn on Spoiler Shield?
          </h3>
          <p className={styles.hint}>
            Answers will only use pages up to where you are, so nothing ahead is revealed. Turn it
            off for a re-read or a textbook. You can change this any time.
          </p>
          <button className={styles.primary} onClick={() => void setShield(true)}>
            Yes, no spoilers
          </button>
          <button className={styles.ask} onClick={() => void setShield(false)}>
            No, use the whole book
          </button>
        </div>
      ) : (
        <>
          <button
            className={styles.shield}
            role="switch"
            aria-checked={shield}
            onClick={() => void setShield(!shield)}
            title={shield ? 'Turn Spoiler Shield off' : 'Turn Spoiler Shield on'}
          >
            <span className={styles.track} aria-hidden="true" />
            <span>
              Spoiler Shield · {shield ? `answers use pages 1–${readingPage}` : 'whole book'}
            </span>
          </button>
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
        </>
      )}
    </>
  )

  return (
    <aside className={styles.panel} aria-label="Ask the book" data-no-turn>
      <header className={styles.head}>
        <h2>Ask the book</h2>
        <button className={styles.iconBtn} aria-label="Close ask panel" onClick={close}>
          ×
        </button>
      </header>
      {bookId ? <IndexGate bookId={bookId}>{askBody}</IndexGate> : askBody}
    </aside>
  )
}
