import { useEffect, useState } from 'react'
import {
  INK_COLORS,
  INK_WIDTHS,
  type LayoutMode,
  type PageTurnStyle,
  type Settings
} from '@shared/types'
import {
  customUrlProblem,
  LOOKUP_LANGUAGES,
  LOOKUP_SITES,
  lookupUrl,
  SITE_INFO,
  type LookupOpenIn,
  type LookupSite
} from '@shared/lookup'
import { THEME_SETTINGS, themeChoice, type ThemeChoice } from '../app/theme'
import { WIDTH_LABELS } from '../reader/ink/inkInput'
import { useSettingsStore } from '../stores/settingsStore'
import styles from './SettingsView.module.css'

type Option<T> = { value: T; label: string }

const THEMES: Option<ThemeChoice>[] = [
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' }
]
const TURN_STYLES: Option<PageTurnStyle>[] = [
  { value: 'curl', label: 'Page flip' },
  { value: 'slide', label: 'Slide' },
  { value: 'instant', label: 'Instant' }
]
const LOOKUP_SITE_OPTIONS: Option<LookupSite>[] = LOOKUP_SITES.map((s) => ({
  value: s,
  label: s === 'custom' ? 'Custom site' : SITE_INFO[s].label
}))
const OPEN_IN: Option<LookupOpenIn>[] = [
  { value: 'app', label: 'In-app window' },
  { value: 'browser', label: 'Default browser' }
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
export function SettingsView({
  onBack,
  embedded
}: {
  onBack?: () => void
  embedded?: boolean // shown as the home page's Settings tab
}): React.JSX.Element {
  const turnSound = useSettingsStore((s) => s.settings.turnSound)
  const showBookmarkTabs = useSettingsStore((s) => s.settings.showBookmarkTabs)
  const set = useSettingsStore((s) => s.set)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBack?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
  return (
    <div
      className={embedded ? styles.embedded : styles.page}
      role={embedded ? undefined : 'dialog'}
      aria-label="Settings"
      data-testid="settings"
    >
      {!embedded && (
        <header className={`${styles.toolbar} app-drag`}>
          <button className={styles.back} onClick={onBack}>
            ← Back
          </button>
          <h1 className={styles.title}>Settings</h1>
        </header>
      )}
      <main className={styles.body}>
        <h2 className={styles.section}>Reading</h2>
        <ThemeSetting />
        <Choice
          name="pageTurnStyle"
          legend="Page turn"
          hint="Page flip falls back to Slide when WebGL is unavailable."
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
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Bookmarks</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={showBookmarkTabs}
              onChange={(e) => void set({ showBookmarkTabs: e.target.checked })}
            />
            Show bookmark tabs
          </label>
        </fieldset>
        <h2 className={styles.section}>Look up</h2>
        <LookupSettings />
        <h2 className={styles.section}>Pen</h2>
        <PenSettings />
      </main>
    </div>
  )
}

/** Which site "Look up" asks, in which language, and where other sites open. */
function LookupSettings(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const { lookupSite, lookupLanguage, lookupCustomUrl } = settings
  // Typed text is kept locally (saving is async) so the caret never jumps.
  const [draft, setDraft] = useState(lookupCustomUrl)
  const problem = lookupSite === 'custom' ? customUrlProblem(draft) : null
  const usesLanguage = lookupSite === 'wikipedia' || lookupSite === 'wiktionary' || !!problem
  return (
    <>
      <Choice
        name="lookupSite"
        legend="Look up on"
        hint={
          lookupSite === 'wikipedia'
            ? 'Select text, right-click and choose Look up: a Wikipedia summary appears beside the page.'
            : 'Look up opens this site with the selected text.'
        }
        options={LOOKUP_SITE_OPTIONS}
      />
      {lookupSite === 'custom' && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Custom site address</legend>
          <input
            className={styles.input}
            type="url"
            aria-label="Custom site address"
            placeholder="https://www.bing.com/search?q={query}"
            spellCheck={false}
            maxLength={500}
            value={draft}
            aria-invalid={!!problem}
            onChange={(e) => {
              setDraft(e.target.value)
              void set({ lookupCustomUrl: e.target.value })
            }}
          />
          <p className={problem ? styles.error : styles.hint}>
            {problem
              ? `${problem} Until then, Look up uses Wikipedia.`
              : `Looking up “ocean” opens ${lookupUrl({ ...settings, lookupCustomUrl: draft }, 'ocean')}`}
          </p>
        </fieldset>
      )}
      {usesLanguage && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Wikipedia language</legend>
          <select
            className={styles.input}
            aria-label="Wikipedia language"
            value={lookupLanguage}
            onChange={(e) => void set({ lookupLanguage: e.target.value })}
          >
            {LOOKUP_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </fieldset>
      )}
      <Choice
        name="lookupOpenIn"
        legend="Open pages in"
        hint="Where full articles and other sites open. Wikipedia summaries always appear in the book."
        options={OPEN_IN}
      />
    </>
  )
}

function PenSettings(): React.JSX.Element {
  const { drawWithMouse, penColor, penWidth } = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  return (
    <>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Input</legend>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={drawWithMouse}
            onChange={(e) => void set({ drawWithMouse: e.target.checked })}
          />
          Draw with mouse
        </label>
        <p className={styles.hint}>
          A pen or stylus always draws in pen mode; the mouse turns pages unless this is on.
        </p>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Default colour</legend>
        <div className={styles.options}>
          {INK_COLORS.map((c) => (
            <label
              key={c}
              className={`${styles.colorOption} ${c === penColor ? styles.selected : ''}`}
            >
              <input
                type="radio"
                name="penColor"
                aria-label={`Ink colour ${c}`}
                checked={c === penColor}
                onChange={() => void set({ penColor: c })}
              />
              <span className={styles.colorDot} style={{ background: c }} />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Default width</legend>
        <div className={styles.options}>
          {INK_WIDTHS.map((w, i) => (
            <label key={w} className={`${styles.option} ${w === penWidth ? styles.selected : ''}`}>
              <input
                type="radio"
                name="penWidth"
                checked={w === penWidth}
                onChange={() => void set({ penWidth: w })}
              />
              {WIDTH_LABELS[i]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

/** Light / Sepia / Dark: sets the app theme and the paper tint together. */
export function ThemeSetting(): React.JSX.Element {
  const current = useSettingsStore((s) => themeChoice(s.settings))
  const set = useSettingsStore((s) => s.set)
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.options}>
        {THEMES.map((o) => (
          <label
            key={o.value}
            className={`${styles.option} ${o.value === current ? styles.selected : ''}`}
          >
            <input
              type="radio"
              name="readerTheme"
              checked={o.value === current}
              onChange={() => void set(THEME_SETTINGS[o.value])}
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className={styles.hint}>Dark inverts page brightness while keeping colours.</p>
    </fieldset>
  )
}
