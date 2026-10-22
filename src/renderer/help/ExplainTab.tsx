import { useEffect, useRef, useState } from 'react'
import { PRIVACY_LINE } from '@shared/ai'
import { useNav } from '../app/nav'
import { useToastStore } from '../stores/toastStore'
import { useHelpStore, type QuickKind } from './helpStore'
import { Markdown } from './Markdown'
import styles from './Help.module.css'

const QUICK: [QuickKind, string][] = [
  ['simpler', 'Simpler'],
  ['detail', 'More detail'],
  ['example', 'Example']
]
const LANGUAGES = ['English', 'Hindi', 'Punjabi', 'Spanish', 'French', 'German', 'Japanese']

/** The Explain tab: the streamed answer, quick actions, follow-ups, errors and setup. */
export function ExplainTab({
  onSaveNote,
  canSaveNote
}: {
  onSaveNote?: () => void
  canSaveNote?: boolean
}): React.JSX.Element {
  const s = useHelpStore()
  const [draft, setDraft] = useState('')
  const [lang, setLang] = useState('Hindi')
  const endRef = useRef<HTMLDivElement>(null)
  const busy = s.messages.some((m) => m.streaming)
  const lastAnswer = [...s.messages].reverse().find((m) => m.role === 'assistant' && m.content)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [s.messages])

  if (!s.hasKey) {
    return (
      <div className={styles.card}>
        <h3>Add an API key to get explanations</h3>
        <p>
          Explanations use your own key for Anthropic, OpenAI or Gemini. It is stored encrypted on
          this computer.
        </p>
        <div className={styles.cardActions}>
          <button className={styles.primary} onClick={() => useNav.getState().openSettings()}>
            Open Settings
          </button>
          <button className={styles.ghost} onClick={() => s.setTab('web')}>
            Search the web instead
          </button>
        </div>
      </div>
    )
  }

  if (s.needsPrivacy) {
    return (
      <div className={styles.card}>
        <h3>Before the first explanation</h3>
        <p>{PRIVACY_LINE}</p>
        <div className={styles.cardActions}>
          <button className={styles.primary} onClick={s.acknowledgePrivacy}>
            Got it
          </button>
        </div>
      </div>
    )
  }

  const keyError = s.error && (s.error.kind === 'invalid_key' || s.error.kind === 'no_key')

  return (
    <div className={styles.explain}>
      <div className={styles.thread} aria-live="polite">
        {s.messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className={styles.userMsg}>
              {m.content}
            </p>
          ) : (
            <div key={i} className={styles.answer} aria-busy={m.streaming}>
              {m.content ? (
                <Markdown text={m.content} />
              ) : (
                <div className={styles.thinking} aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          )
        )}
        {s.error && (
          <div className={styles.error} role="alert">
            <p>{s.error.message}</p>
            <div className={styles.cardActions}>
              <button className={styles.ghost} onClick={s.retry}>
                Retry
              </button>
              {keyError && (
                <button className={styles.ghost} onClick={() => useNav.getState().openSettings()}>
                  Open Settings
                </button>
              )}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.quick} role="group" aria-label="Quick actions">
        {QUICK.map(([k, label]) => (
          <button
            key={k}
            className={styles.chip}
            disabled={busy || !lastAnswer}
            onClick={() => s.quick(k)}
          >
            {label}
          </button>
        ))}
        <span className={styles.translate}>
          <button
            className={styles.chip}
            disabled={busy || !lastAnswer}
            onClick={() => s.quick('translate', lang)}
          >
            Translate
          </button>
          <select
            className={styles.langSelect}
            aria-label="Translate into"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </span>
      </div>

      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim() || busy) return
          s.ask(draft)
          setDraft('')
        }}
      >
        <input
          className={styles.askInput}
          aria-label="Ask a follow-up"
          placeholder={busy ? 'Answering… (you can type your next question)' : 'Ask a follow-up…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>

      <div className={styles.footer}>
        <button
          className={styles.ghost}
          disabled={!lastAnswer}
          onClick={() => {
            void navigator.clipboard.writeText(lastAnswer?.content ?? '')
            useToastStore.getState().show('Copied')
          }}
        >
          Copy
        </button>
        <button
          className={styles.ghost}
          disabled={!canSaveNote || !lastAnswer || busy}
          title={
            canSaveNote ? 'Save this explanation as a note on the passage' : 'Requires annotations'
          }
          onClick={onSaveNote}
        >
          Save as note
        </button>
      </div>
    </div>
  )
}
