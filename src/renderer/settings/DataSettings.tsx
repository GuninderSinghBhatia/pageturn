import { useState } from 'react'
import { useLibraryStore } from '../stores/libraryStore'
import styles from './SettingsView.module.css'

/** Settings → Data: data folder, and manual JSON backup export / import. */
export function DataSettings(): React.JSX.Element {
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null)
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Backups</legend>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => void window.api.export.openDataFolder()}>
          Open data folder
        </button>
        <button
          className={styles.button}
          onClick={async () => {
            const r = await window.api.export.backup()
            if (r.saved) setStatus({ error: false, text: `Backup saved to ${r.path}` })
          }}
        >
          Export backup (JSON)
        </button>
        <button
          className={styles.button}
          onClick={async () => {
            const r = await window.api.export.importBackup()
            if ('error' in r) {
              if (r.error !== 'cancelled') setStatus({ error: true, text: r.error })
              return
            }
            setStatus({
              error: false,
              text: `Imported: ${r.added} added, ${r.updated} updated, ${r.skipped} already up to date.`
            })
            void useLibraryStore.getState().refresh()
          }}
        >
          Import backup
        </button>
      </div>
      {status && (
        <p className={status.error ? styles.error : styles.hint} role="status">
          {status.text}
        </p>
      )}
      <p className={styles.hint}>
        A backup is also made automatically each day (the last 7 are kept). Backups never contain
        your API keys.
      </p>
    </fieldset>
  )
}
