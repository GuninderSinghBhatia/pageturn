import { useEffect } from 'react'
import type { LayoutMode, PageTurnStyle, PaperTint, Settings, Theme } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import styles from './SettingsView.module.css'

type Option<T> = { value: T; label: string }

const THEMES: Option<Theme>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]
const TINTS: Option<PaperTint>[] = [
  { value: 'white', label: 'White' },
  { value: 'cream', label: 'Cream' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Night' }
]
const TURN_STYLES: Option<PageTurnStyle>[] = [
  { value: 'curl', label: 'Page curl' },
  { value: 'slide', label: 'Slide' },
  { value: 'instant', label: 'Instant' }
]
const LAYOUTS: Option<LayoutMode>[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'spread', label: 'Two pages' },
  { value: 'single', label: 'Single page' }
]

function Choice<K extends keyof Settings>({
  name,
  legend,
  hint,
  options
}: {
  name: K
  legend: string
  hint?: string
  options: Option<Settings[K]>[]
}): React.JSX.Element {
  const value = useSettingsStore((s) => s.settings[name])
  const set = useSettingsStore((s) => s.set)
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`${styles.option} ${o.value === value ? styles.selected : ''}`}
          >
            <input
              type="radio"
              name={name}
              checked={o.value === value}
              onChange={() => void set({ [name]: o.value } as Partial<Settings>)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </fieldset>
  )
}

/** Reading preferences; every change is saved immediately. */
export function SettingsView({ onBack }: { onBack(): void }): React.JSX.Element {
  const turnSound = useSettingsStore((s) => s.settings.turnSound)
  const set = useSettingsStore((s) => s.set)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
  return (
    <div className={styles.page} role="dialog" aria-label="Settings" data-testid="settings">
      <header className={styles.toolbar}>
        <button className={styles.back} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>Settings</h1>
      </header>
      <main className={styles.body}>
        <h2 className={styles.section}>Reading</h2>
        <Choice name="theme" legend="Theme" options={THEMES} />
        <Choice
          name="paperTint"
          legend="Paper"
          hint="Night inverts page brightness while keeping colours."
          options={TINTS}
        />
        <Choice
          name="pageTurnStyle"
          legend="Page turn"
          hint="Page curl falls back to Slide when WebGL is unavailable or reduced motion is on."
          options={TURN_STYLES}
        />
        <Choice
          name="layout"
          legend="Default layout"
          hint="Automatic shows two pages when the window is wide enough."
          options={LAYOUTS}
        />
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Sound</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={turnSound}
              onChange={(e) => void set({ turnSound: e.target.checked })}
            />
            Turn sound
          </label>
        </fieldset>
      </main>
    </div>
  )
}
