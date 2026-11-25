import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { applyTheme } from '../app/theme'

type SettingsState = {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  set(partial: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await window.api.settings.get()
    applyTheme(settings.theme)
    set({ settings, loaded: true })
  },
  // Optimistic: controls (radios, switches) update at once; Rust's validated answer replaces the
  // guess, and a rejected change is rolled back.
  set: async (partial) => {
    const before = get().settings
    const guess = { ...before, ...partial }
    applyTheme(guess.theme)
    set({ settings: guess })
    try {
      const settings = await window.api.settings.set(partial)
      applyTheme(settings.theme)
      set({ settings })
    } catch (err) {
      applyTheme(before.theme)
      set({ settings: before })
      throw err
    }
  }
}))
