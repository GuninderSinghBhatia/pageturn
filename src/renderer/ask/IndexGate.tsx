import { useEffect, useState } from 'react'
import type { RagIndexStatus } from '@shared/ipc'
import { useAskStore } from './askStore'
import styles from './Ask.module.css'

const POLL_MS = 1500

/**
 * Shows the Ask form only once the open book is indexed. Every added book is indexed in the
 * background by rag-service; until it is done this shows progress, a failure (with Try again),
 * or that the service is not running. A book the service has never seen is queued here too.
 */
export function IndexGate({
  bookId,
  children
}: {
  bookId: string
  children: React.ReactNode
}): React.JSX.Element {
  const [status, setStatus] = useState<{ bookId: string; s: RagIndexStatus } | null>(null)
  const [attempt, setAttempt] = useState({ n: 0, retry: false })

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async (first: boolean): Promise<void> => {
      let s =
        first && attempt.retry
          ? await window.api.rag.indexBook(bookId, true)
          : await window.api.rag.indexStatus(bookId)
      // Not seen yet (e.g. rag-service was off when the book was added): queue it now.
      if (first && s.ok && s.state === 'missing') s = await window.api.rag.indexBook(bookId, false)
      if (!live) return
      setStatus({ bookId, s })
      if (s.ok && (s.state === 'queued' || s.state === 'indexing')) {
        timer = setTimeout(() => void check(false), POLL_MS)
      }
    }
    void check(true)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [bookId, attempt])

  const s = status?.bookId === bookId ? status.s : null
  const ready = !!s && s.ok && s.state === 'done'

  // Lets a waiting "Who is this?" run once the book is ready.
  useEffect(() => {
    useAskStore.getState().setReadyBook(ready ? bookId : null)
  }, [ready, bookId])

  if (ready) return <>{children}</>

  const again = (retry: boolean): void => setAttempt((a) => ({ n: a.n + 1, retry }))
  const pct = s?.ok && s.total > 0 ? Math.round((100 * s.done) / s.total) : 0

  return (
    <div className={styles.indexCard} role="status" aria-live="polite">
      {!s ? (
        <p className={styles.hint}>Checking whether this book is ready for Ask…</p>
      ) : !s.ok ? (
        <>
          <p>Ask needs the RAG service, and it isn&apos;t running.</p>
          <p className={styles.hint}>
            Start it, and this book will be indexed automatically. ({s.error})
          </p>
          <button className={styles.ask} onClick={() => again(false)}>
            Check again
          </button>
        </>
      ) : s.state === 'failed' ? (
        <>
          <p>This book couldn&apos;t be indexed for Ask.</p>
          {s.error && <p className={styles.hint}>{s.error}</p>}
          <button className={styles.ask} onClick={() => again(true)}>
            Try again
          </button>
        </>
      ) : (
        <>
          <p>
            {s.state === 'indexing'
              ? `Indexing this book for Ask… ${pct}%`
              : 'Waiting to index this book for Ask (another book is being indexed first)…'}
          </p>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Indexing progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className={styles.hint}>
            This happens once per book, on this computer. You can keep reading meanwhile.
          </p>
        </>
      )}
    </div>
  )
}
