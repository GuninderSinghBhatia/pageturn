import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import styles from './SettingsView.module.css'

const STATUS: Record<string, string> = {
  current: 'You have the latest version.',
  dev: 'Updates are checked in the installed app.',
  error: 'Could not check for updates. Try again later.'
}

/** Settings → About: version, updates, logs, and the tour again. */
export function AboutSettings(): React.JSX.Element {
  const set = useSettingsStore((s) => s.set)
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [ready, setReady] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.api.app?.version?.().then((v) => live && setVersion(v))
    const off = window.api.app?.onUpdateDownloaded?.((e) => setReady(e.version))
    return () => {
      live = false
      off?.()
    }
  }, [])

  return (
    <>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>PageTurn {version}</legend>
        <div className={styles.row}>
          {ready ? (
            <button className={styles.button} onClick={() => void window.api.app.installUpdate()}>
              Restart to update to {ready}
            </button>
          ) : (
            <button
              className={styles.button}
              onClick={async () => {
                setStatus('Checking…')
                const r = await window.api.app.checkForUpdates()
                setStatus(
                  r.status === 'available'
                    ? `Version ${r.version} is downloading; you'll be asked to restart.`
                    : STATUS[r.status]
                )
              }}
            >
              Check for updates
            </button>
          )}
          <button className={styles.button} onClick={() => void window.api.app.openLogs()}>
            Open logs folder
          </button>
        </div>
        {status && (
          <p className={styles.hint} role="status">
            {status}
          </p>
        )}
        <p className={styles.hint}>No usage data is collected or sent.</p>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Getting started</legend>
        <div className={styles.row}>
          <button className={styles.button} onClick={() => void set({ onboardingDone: false })}>
            Show tour again
          </button>
        </div>
      </fieldset>
    </>
  )
}
