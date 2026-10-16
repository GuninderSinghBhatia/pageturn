import { useEffect } from 'react'
import type { PaperTint } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { useNav } from './nav'

/** Page colour per paper tint (the reader's book reaches the window's top-right corner). */
const PAPER: Record<PaperTint, string> = {
  white: '#ffffff',
  cream: '#faf8f4',
  sepia: '#f4ecd8',
  dark: '#2a2a2a'
}

/**
 * Keeps the floating minimise / maximise / close buttons the colour of whatever sits behind
 * them: the page while reading, the header in the library and Settings.
 */
export function useTitleBar(): void {
  const view = useNav((s) => s.view)
  const settingsOpen = useNav((s) => s.settingsOpen)
  const { theme, paperTint } = useSettingsStore((s) => s.settings)

  useEffect(() => {
    const darkUi = document.documentElement.dataset.theme === 'dark'
    const reading = view !== 'library' && !settingsOpen
    const color = reading ? PAPER[paperTint] : darkUi ? '#262320' : '#fffdf9'
    const darkBg = reading ? paperTint === 'dark' : darkUi
    void window.api.window.setTitleBar({ color, symbolColor: darkBg ? '#dadada' : '#5b5550' })
  }, [view, settingsOpen, theme, paperTint])
}
