import { useSettingsStore } from '../stores/settingsStore'
import styles from './SettingsView.module.css'

/** Settings → About: the tour again (version and updates arrive with packaging). */
export function AboutSettings(): React.JSX.Element {
  const set = useSettingsStore((s) => s.set)
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Getting started</legend>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => void set({ onboardingDone: false })}>
          Show tour again
        </button>
      </div>
    </fieldset>
  )
}
