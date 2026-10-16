import { useEffect } from 'react'
import type { PaperTint, Settings, Theme } from '@shared/types'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The reader's single theme choice; stored as an app theme plus a paper tint. */
export type ThemeChoice = 'light' | 'sepia' | 'dark'

export const THEME_SETTINGS: Record<ThemeChoice, { theme: Theme; paperTint: PaperTint }> = {
  light: { theme: 'light', paperTint: 'cream' },
  sepia: { theme: 'light', paperTint: 'sepia' },
  dark: { theme: 'dark', paperTint: 'dark' }
}

export function themeChoice(s: Pick<Settings, 'theme' | 'paperTint'>): ThemeChoice {
  if (s.theme === 'dark' || s.paperTint === 'dark') return 'dark'
  return s.paperTint === 'sepia' ? 'sepia' : 'light'
}

/** Sets `data-theme` on <html> to the concrete theme; `system` follows the OS setting. */
export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

/** Keeps <html data-theme> in sync with the setting, and with the OS while on `system`. */
export function useThemeSync(theme: Theme): void {
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}
