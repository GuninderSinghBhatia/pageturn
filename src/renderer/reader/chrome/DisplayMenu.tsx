import type { ResolvedLayout } from '../layout'
import { THEME_SETTINGS, themeChoice, type ThemeChoice } from '../../app/theme'
import { useNav } from '../../app/nav'
import { useSettingsStore } from '../../stores/settingsStore'
import styles from './Toolbar.module.css'

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' }
]

type Props = {
  zoom: number
  layout: ResolvedLayout
  onZoom(z: number): void
  onLayout(l: ResolvedLayout): void
}

/** "Aa": theme, zoom, single/two pages and a way into Settings. */
export function DisplayMenu({ zoom, layout, onZoom, onLayout }: Props): React.JSX.Element {
  const theme = useSettingsStore((s) => themeChoice(s.settings))
  const set = useSettingsStore((s) => s.set)
  return (
    <div className={styles.popover} role="dialog" aria-label="Display">
      <div className={styles.row}>
        {THEMES.map((t) => (
          <button
            key={t.value}
            className={`${styles.chip} ${styles[`theme_${t.value}`]}`}
            aria-pressed={theme === t.value}
            onClick={() => void set(THEME_SETTINGS[t.value])}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <button className={styles.chip} aria-label="Zoom out" onClick={() => onZoom(zoom / 1.25)}>
          −
        </button>
        <span className={styles.zoom}>{Math.round(zoom * 100)}%</span>
        <button className={styles.chip} aria-label="Zoom in" onClick={() => onZoom(zoom * 1.25)}>
          +
        </button>
      </div>
      <div className={styles.row}>
        <button
          className={styles.chip}
          aria-pressed={layout === 'single'}
          onClick={() => onLayout('single')}
        >
          Single page
        </button>
        <button
          className={styles.chip}
          aria-pressed={layout === 'spread'}
          onClick={() => onLayout('spread')}
        >
          Two pages
        </button>
      </div>
      <button
        className={styles.menuLink}
        aria-label="Settings"
        onClick={useNav.getState().openSettings}
      >
        Settings…
      </button>
    </div>
  )
}
