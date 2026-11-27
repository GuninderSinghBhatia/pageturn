import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_MODELS,
  isKeyProvider,
  MODEL_OPTIONS,
  PRIVACY_LINE,
  PROVIDER_LABELS,
  PROVIDERS,
  type ChatGptStatus,
  type ClaudeStatus,
  type HelpDefaultTab,
  type KeyProviderId,
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
  ['auto', 'Explain if AI is set up, otherwise Web'],
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
  type Model = { id: string; label: string }
  const [liveModels, setLiveModels] = useState<{ provider: ProviderId; models: Model[] } | null>(
    null
  )
  const [status, setStatus] = useState<Status>(null)
  const keyProvider: KeyProviderId | null = isKeyProvider(provider) ? provider : null

  useEffect(() => {
    if (!keyProvider) return
    let live = true
    void window.api.settings.hasApiKey(keyProvider).then((h) => live && setHasKey(h))
    return () => {
      live = false
    }
  }, [keyProvider])

  // With a saved key, also offer the models that key can use (newer ones appear here).
  useEffect(() => {
    if (!hasKey || !keyProvider) return
    const provider = keyProvider
    let live = true
    void window.api.ai
      .listModels(provider)
      .then(
        (ids) => live && setLiveModels({ provider, models: ids.map((id) => ({ id, label: id })) })
      )
    return () => {
      live = false
    }
  }, [keyProvider, hasKey])

  const onChatGptModels = useCallback(
    (models: Model[]) => setLiveModels({ provider: 'chatgpt', models }),
    []
  )

  const current = settings.aiModel ?? DEFAULT_MODELS[provider]
  const known = MODEL_OPTIONS[provider]
  const extra = [
    ...(liveModels?.provider === provider ? liveModels.models : []),
    { id: current, label: current }
  ].filter(
    (m, i, all) => all.findIndex((o) => o.id === m.id) === i && !known.some((k) => k.id === m.id)
  )

  const [ragStatus, setRagStatus] = useState<Status>(null)
  const checkRag = async (): Promise<void> => {
    setRagStatus({ kind: 'info', text: 'Checking…' })
    const r = await window.api.rag.health()
    setRagStatus(
      r.ok ? { kind: 'ok', text: `✓ ${JSON.stringify(r.body)}` } : { kind: 'error', text: r.error }
    )
  }

  const save = async (): Promise<void> => {
    if (!keyProvider) return
    try {
      await window.api.settings.setApiKey(keyProvider, draft.trim())
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
    if (!keyProvider) return
    setStatus({ kind: 'info', text: 'Testing…' })
    const r = await window.api.ai.testKey(keyProvider)
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
            void set({ aiProvider: e.target.value as ProviderId, aiModel: null })
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </fieldset>

      {provider === 'claude' && <ClaudePlan />}
      {provider === 'chatgpt' && <ChatGptPlan onModels={onChatGptModels} />}

      {keyProvider && (
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
                await window.api.settings.clearApiKey(keyProvider)
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
            <p className={styles.hint}>No key saved for {PROVIDER_LABELS[keyProvider]}.</p>
          )}
        </fieldset>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Model</legend>
        <select
          className={styles.input}
          aria-label="Model"
          value={current}
          onChange={(e) =>
            void set({
              aiModel: e.target.value === DEFAULT_MODELS[provider] ? null : e.target.value
            })
          }
        >
          {known.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          {provider !== 'claude' && extra.length > 0 && (
            <optgroup
              label={
                provider === 'chatgpt'
                  ? 'Available on your ChatGPT plan'
                  : 'Also available with your key'
              }
            >
              {extra.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className={styles.hint}>
          {provider === 'claude'
            ? 'Your Claude plan decides which models you can use.'
            : provider === 'chatgpt'
              ? 'Your ChatGPT plan decides which models you can use.'
              : hasKey
                ? 'Your key decides which models you can use.'
                : 'Save a key to see every model it can use.'}
        </p>
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

      <fieldset className={styles.group}>
        <legend className={styles.legend}>RAG service</legend>
        <div className={styles.row}>
          <button className={styles.button} onClick={() => void checkRag()}>
            Check health
          </button>
        </div>
        {ragStatus && (
          <p className={ragStatus.kind === 'error' ? styles.error : styles.hint} role="status">
            {ragStatus.text}
          </p>
        )}
      </fieldset>
    </>
  )
}

/** The Claude plan: the reader's own Claude Code, signed in with their Claude subscription. */
function ClaudePlan(): React.JSX.Element {
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)
  const [note, setNote] = useState<Status>(null)

  const refresh = (): Promise<void> => window.api.ai.claudeStatus().then(setClaude)

  useEffect(() => {
    let live = true
    const load = (): void =>
      void window.api.ai.claudeStatus().then((s) => {
        if (live) setClaude(s)
      })
    load()
    // Sign-in happens in another window: check again when the reader comes back.
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [])

  const signIn = async (): Promise<void> => {
    try {
      await window.api.ai.claudeLogin()
      setNote({
        kind: 'info',
        text: 'A Claude Code window opened. Finish signing in in your browser, then come back here.'
      })
    } catch (err) {
      setNote({ kind: 'error', text: String((err as Error).message ?? err) })
    }
  }

  const summary: Status =
    claude === null
      ? { kind: 'info', text: 'Checking Claude Code…' }
      : !claude.installed
        ? {
            kind: 'error',
            text: 'Claude Code is not installed on this computer. Install it (claude.com/code), then click Check again.'
          }
        : !claude.loggedIn
          ? {
              kind: 'error',
              text: `Claude Code ${claude.version} is installed but not signed in.`
            }
          : {
              kind: 'ok',
              text: `✓ Signed in to Claude Code ${claude.version}${claude.plan ? ` (${claude.plan} plan)` : ''}.`
            }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Claude plan</legend>
      <p className={summary.kind === 'error' ? styles.error : styles.hint} role="status">
        {summary.text}
      </p>
      <div className={styles.row}>
        {claude?.installed && !claude.loggedIn && (
          <button className={styles.button} onClick={() => void signIn()}>
            Sign in
          </button>
        )}
        <button
          className={styles.button}
          onClick={() => {
            setNote(null)
            setClaude(null)
            void refresh()
          }}
        >
          Check again
        </button>
      </div>
      {note && <p className={note.kind === 'error' ? styles.error : styles.hint}>{note.text}</p>}
      <p className={styles.hint}>
        Explanations use your Claude subscription&apos;s limits, not an API key. PageTurn runs your
        own Claude Code with no tools, so it cannot open or change your files, and it never sees
        your sign-in.
      </p>
    </fieldset>
  )
}

/**
 * The ChatGPT plan: Sign in with ChatGPT (OpenAI's plan sign-in for open-source local apps).
 * Follows OpenAI's guidelines: "Continue with ChatGPT", a one-time "You're using your ChatGPT
 * plan" notice, and "Manage usage" links to ChatGPT settings.
 */
function ChatGptPlan({
  onModels
}: {
  onModels: (models: { id: string; label: string }[]) => void
}): React.JSX.Element {
  const [st, setSt] = useState<ChatGptStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Status>(null)

  useEffect(() => {
    let live = true
    void window.api.ai.chatgptStatus().then((s) => {
      if (live) setSt(s)
    })
    return () => {
      live = false
    }
  }, [])

  // Signed in with plan use: offer the account's own models.
  const ready = !!st?.signedIn && st.planUse
  useEffect(() => {
    if (!ready) return
    let live = true
    void window.api.ai.chatgptModels().then((m) => {
      if (live) onModels(m)
    })
    return () => {
      live = false
    }
  }, [ready, onModels])

  const signIn = async (consent: boolean): Promise<void> => {
    setBusy(true)
    setNote({ kind: 'info', text: 'Finish signing in in your browser…' })
    const r = await window.api.ai.chatgptLogin(consent)
    setBusy(false)
    setSt(r.status)
    setNote(r.ok ? null : { kind: 'error', text: r.error })
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.ai.chatgptLogout()
    setBusy(false)
    setSt(await window.api.ai.chatgptStatus())
    setNote({
      kind: 'info',
      text: r.confirmed
        ? 'Signed out.'
        : "Signed out on this computer, but OpenAI couldn't be told. You can disconnect PageTurn in ChatGPT settings."
    })
  }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Use your ChatGPT plan</legend>
      {st === null ? (
        <p className={styles.hint} role="status">
          Checking…
        </p>
      ) : !st.signedIn ? (
        <>
          <p className={styles.hint}>
            Get explanations with the usage included in your ChatGPT plan, instead of an API key.
          </p>
          <div className={styles.row}>
            <button
              className={styles.chatgptButton}
              disabled={busy}
              onClick={() => void signIn(false)}
            >
              Continue with ChatGPT
            </button>
          </div>
        </>
      ) : !st.planUse ? (
        <>
          <p className={styles.error} role="status">
            Signed in{st.email ? ` as ${st.email}` : ''}, but PageTurn doesn&apos;t have permission
            to use your ChatGPT plan.
          </p>
          <div className={styles.row}>
            <button className={styles.button} disabled={busy} onClick={() => void signIn(true)}>
              Allow plan use
            </button>
            <button className={styles.button} disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.hint} role="status">
            ✓ Using ChatGPT plan{st.email ? ` (${st.email})` : ''}.
          </p>
          <div className={styles.row}>
            <button className={styles.button} onClick={() => void window.api.ai.chatgptOpenUsage()}>
              Manage usage
            </button>
            <button className={styles.button} disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </>
      )}
      {note && (
        <p className={note.kind === 'error' ? styles.error : styles.hint} role="status">
          {note.text}
        </p>
      )}
      {ready && !st.welcomed && (
        <div className={styles.notice} role="dialog" aria-labelledby="chatgpt-welcome">
          <h3 id="chatgpt-welcome">You&apos;re using your ChatGPT plan</h3>
          <p className={styles.hint}>
            Explanations in PageTurn now use your ChatGPT plan. You can see and manage this usage in
            ChatGPT settings.
          </p>
          <div className={styles.row}>
            <button
              className={styles.button}
              onClick={() => {
                void window.api.ai.chatgptWelcomed()
                setSt({ ...st, welcomed: true })
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      <p className={styles.hint}>
        PageTurn keeps your ChatGPT sign-in encrypted on this computer and only uses it for the text
        you ask about.
      </p>
    </fieldset>
  )
}
