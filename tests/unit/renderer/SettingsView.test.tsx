// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { SettingsView } from '@renderer/settings/SettingsView'
import { applyTheme } from '@renderer/app/theme'
import { useSettingsStore } from '@renderer/stores/settingsStore'

let stored: Settings
let setSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  stored = { ...DEFAULT_SETTINGS }
  setSpy = vi.fn(async (partial: Partial<Settings>) => (stored = { ...stored, ...partial }))
  window.api = {
    settings: { get: vi.fn(async () => stored), set: setSpy }
  } as unknown as typeof window.api
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  delete document.documentElement.dataset.theme
})
afterEach(cleanup)

describe('SettingsView', () => {
  it('changing the page-turn style to Slide saves it and updates the store', async () => {
    render(<SettingsView onBack={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Slide' }))
    expect(setSpy).toHaveBeenCalledWith({ pageTurnStyle: 'slide' })
    await waitFor(() => expect(useSettingsStore.getState().settings.pageTurnStyle).toBe('slide'))
    expect((screen.getByRole('radio', { name: 'Slide' }) as HTMLInputElement).checked).toBe(true)
  })

  it('choosing the Dark theme sets data-theme on <html>', async () => {
    render(<SettingsView onBack={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('saves paper tint, default layout and turn sound', async () => {
    render(<SettingsView onBack={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Two pages' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /turn sound/i }))
    expect(setSpy).toHaveBeenCalledWith({ paperTint: 'sepia' })
    expect(setSpy).toHaveBeenCalledWith({ layout: 'spread' })
    expect(setSpy).toHaveBeenCalledWith({ turnSound: true })
  })

  it('saves pen preferences', () => {
    render(<SettingsView onBack={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /draw with mouse/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Thick' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ink colour #2a62c9' }))
    expect(setSpy).toHaveBeenCalledWith({ drawWithMouse: true })
    expect(setSpy).toHaveBeenCalledWith({ penWidth: 0.01 })
    expect(setSpy).toHaveBeenCalledWith({ penColor: '#2a62c9' })
  })

  it('Back calls onBack', () => {
    const onBack = vi.fn()
    render(<SettingsView onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('applyTheme', () => {
  it('system follows prefers-color-scheme', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
