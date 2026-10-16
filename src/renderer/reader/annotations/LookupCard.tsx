import { useEffect, useState } from 'react'
import type { WikiSummary } from '@shared/ipc'
import { lookupUrl } from '@shared/lookup'
import { useNav } from '../../app/nav'
import { useSettingsStore } from '../../stores/settingsStore'
import styles from './Annotations.module.css'

type Result =
  | { status: 'loading' }
  | { status: 'found'; summary: WikiSummary }
  | { status: 'none' }
  | { status: 'error' }

const CARD_W = 340

/** Wikipedia summary for a selected phrase, with links to the full article and to Settings. */
export function LookupCard({
  card
}: {
  card: { text: string; x: number; y: number }
}): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const lang = settings.lookupLanguage
  const query = card.text.slice(0, 300)
  const [result, setResult] = useState<Result>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    window.api.lookup.wikipedia(query, lang).then(
      (summary) => live && setResult(summary ? { status: 'found', summary } : { status: 'none' }),
      () => live && setResult({ status: 'error' })
    )
    return () => {
      live = false
    }
  }, [query, lang, attempt])

  const open = (url: string): void => void window.api.lookup.open(url, settings.lookupOpenIn)
  const searchUrl = lookupUrl({ ...settings, lookupSite: 'wikipedia' }, query)
  const shortQuery = query.length > 60 ? `${query.slice(0, 57)}…` : query

  return (
    <div
      className={`${styles.phraseCard} ${styles.lookupCard}`}
      role="dialog"
      aria-label="Look up"
      aria-busy={result.status === 'loading'}
      data-phrase-card
      data-no-turn
      style={{
        width: CARD_W,
        left: Math.max(16, Math.min(card.x, window.innerWidth - CARD_W - 16)),
        top: Math.max(16, Math.min(card.y + 8, window.innerHeight - 380))
      }}
    >
      <div className={styles.phraseHead}>
        <strong className={styles.phraseTitle}>
          {result.status === 'found' ? result.summary.title : shortQuery}
        </strong>
        <span className={styles.phraseLabel}>WIKIPEDIA · {lang.toUpperCase()}</span>
      </div>

      {result.status === 'loading' && (
        <div className={styles.lookupSkeleton} aria-label="Looking up">
          <span />
          <span />
          <span />
        </div>
      )}

      {result.status === 'found' && (
        <>
          {result.summary.description && (
            <p className={styles.lookupDesc}>{result.summary.description}</p>
          )}
          <div className={styles.lookupBody}>
            {result.summary.thumbnail && (
              <img className={styles.lookupThumb} src={result.summary.thumbnail} alt="" />
            )}
            <p className={styles.phraseBody}>{result.summary.extract}</p>
          </div>
        </>
      )}

      {result.status === 'none' && (
        <p className={styles.phraseBody}>No Wikipedia article matches “{shortQuery}”.</p>
      )}
      {result.status === 'error' && (
        <p className={styles.phraseBody}>
          Couldn’t reach Wikipedia. Check your internet connection.
        </p>
      )}

      <div className={styles.lookupActions}>
        {result.status === 'found' && (
          <button className={styles.lookupPrimary} onClick={() => open(result.summary.url)}>
            Read on Wikipedia ↗
          </button>
        )}
        {(result.status === 'none' || result.status === 'error') && (
          <button className={styles.lookupPrimary} onClick={() => open(searchUrl)}>
            Search Wikipedia ↗
          </button>
        )}
        {result.status === 'error' && (
          <button
            className={styles.lookupLink}
            onClick={() => {
              setResult({ status: 'loading' })
              setAttempt((a) => a + 1)
            }}
          >
            Try again
          </button>
        )}
        <button
          className={styles.lookupLink}
          onClick={() => {
            useNav.getState().openSettings()
          }}
        >
          Change site
        </button>
      </div>
    </div>
  )
}
