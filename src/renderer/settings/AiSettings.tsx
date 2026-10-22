import { useEffect, useState } from 'react'
import {
  DEFAULT_MODELS,
  PRIVACY_LINE,
  PROVIDER_LABELS,
  PROVIDERS,
  type HelpDefaultTab,
  type ProviderId,
  type SearchEngine
} from '@shared/ai'
import { useSettingsStore } from '../stores/settingsStore'
import styles from './SettingsView.module.css'

type Status = { kind: 'ok' | 'error' | 'info'; text: string } | null

const ENGINES: [SearchEngine, string][] = [
  ['duckduckgo', 'DuckDuckGo'],
  ['google', 'Google'],
  ['bing', 'Bing']
]
const TABS: [HelpDefaultTab, string][] = [
  ['auto', 'Explain if a key is set, otherwise Web'],
  ['explain', 'Explain'],
  ['web', 'Web']
]

/** Help panel settings: AI provider, encrypted API key, model, web search. */
export function AiSettings(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const provider = settings.aiProvider
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState(settings.aiModel ?? '')
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    let live = true
    void window.api.settings.hasApiKey(provider).then((h) => live && setHasKey(h))
    return () => {
      live = false
    }
  }, [provider])

  const save = async (): Promise<void> => {
    try {
      await window.api.settings.setApiKey(provider, draft.trim())
      setDraft('')
      setHasKey(true)
      setStatus({ kind: 'ok', text: 'Key saved (encrypted on this computer).' })
    } catch (err) {
      const msg = String((err as Error).message ?? err)
      setStatus({
        kind: 'error',
        text: /unavailable/i.test(msg)
          ? 'Secure storage unavailable on this system, so the key cannot be saved.'
          : 'The key could not be saved.'
      })
    }
  }

  const test = async (): Promise<void> => {
    setStatus({ kind: 'info', text: 'Testing…' })
    const r = await window.api.ai.testKey(provider)
    setStatus(
      r.ok ? { kind: 'ok', text: '✓ Key works.' } : { kind: 'error', text: r.error.message }
    )
  }

  return (
    <>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>AI provider</legend>
        <select
          className={styles.input}
          aria-label="Provider"
          value={provider}
          onChange={(e) => {
            setStatus(null)
            void set({ aiProvider: e.target.value as ProviderId })
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>API key</legend>
        <div className={styles.row}>
          <input
            className={styles.input}
            type="password"
            aria-label="API key"
            autoComplete="off"
            spellCheck={false}
            placeholder={hasKey ? '•••••••• (saved)' : 'Paste your key'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className={styles.button} disabled={!draft.trim()} onClick={() => void save()}>
            Save key
          </button>
          <button className={styles.button} disabled={!hasKey} onClick={() => void test()}>
            Test key
          </button>
          <button
            className={styles.button}
            disabled={!hasKey}
            onClick={async () => {
              await window.api.settings.clearApiKey(provider)
              setHasKey(false)
              setStatus({ kind: 'info', text: 'Key removed.' })
            }}
          >
            Clear
          </button>
        </div>
        {status && (
          <p className={status.kind === 'error' ? styles.error : styles.hint} role="status">
            {status.text}
          </p>
        )}
        {hasKey === false && !status && (
          <p className={styles.hint}>No key saved for {PROVIDER_LABELS[provider]}.</p>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Model</legend>
        <input
          className={styles.input}
          aria-label="Model"
          spellCheck={false}
          placeholder={DEFAULT_MODELS[provider]}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => void set({ aiModel: model.trim() || null })}
        />
        <p className={styles.hint}>Leave empty to use {DEFAULT_MODELS[provider]}.</p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Web search</legend>
        <select
          className={styles.input}
          aria-label="Search engine"
          value={settings.searchEngine}
          onChange={(e) => void set({ searchEngine: e.target.value as SearchEngine })}
        >
          {ENGINES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.searchIncludeTitle}
            onChange={(e) => void set({ searchIncludeTitle: e.target.checked })}
          />
          Include the book title in searches
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Help panel</legend>
        <select
          className={styles.input}
          aria-label="Help opens on"
          value={settings.helpDefaultTab}
          onChange={(e) => void set({ helpDefaultTab: e.target.value as HelpDefaultTab })}
        >
          {TABS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <p className={styles.hint}>{PRIVACY_LINE}</p>
      </fieldset>
    </>
  )
}
