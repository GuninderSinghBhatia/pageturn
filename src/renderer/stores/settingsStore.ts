import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

type SettingsState = {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  set(partial: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => set({ settings: await window.api.settings.get(), loaded: true }),
  set: async (partial) => set({ settings: await window.api.settings.set(partial) })
}))
