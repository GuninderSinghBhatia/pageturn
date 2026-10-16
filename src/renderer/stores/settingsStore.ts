import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { applyTheme } from '../app/theme'

type SettingsState = {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  set(partial: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await window.api.settings.get()
    applyTheme(settings.theme)
    set({ settings, loaded: true })
  },
  set: async (partial) => {
    const settings = await window.api.settings.set(partial)
    applyTheme(settings.theme)
    set({ settings })
  }
}))
