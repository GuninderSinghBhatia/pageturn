// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { SettingsView } from '@renderer/settings/SettingsView'
import { applyTheme, themeChoice } from '@renderer/app/theme'
import { useSettingsStore } from '@renderer/stores/settingsStore'

let stored: Settings
let setSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  stored = { ...DEFAULT_SETTINGS }
  setSpy = vi.fn(async (partial: Partial<Settings>) => (stored = { ...stored, ...partial }))
  window.api = {
    settings: { get: vi.fn(async () => stored), set: setSpy, hasApiKey: vi.fn(async () => false) }
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
    expect(setSpy).toHaveBeenCalledWith({ theme: 'dark', paperTint: 'dark' })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('saves theme, default layout, turn sound and bookmark tabs', async () => {
    render(<SettingsView onBack={() => {}} />)
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('radio', { name: 'System' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /show bookmark tabs/i }))
    expect(setSpy).toHaveBeenCalledWith({ showBookmarkTabs: false })
    fireEvent.click(screen.getByRole('radio', { name: 'Two pages' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /turn sound/i }))
    expect(setSpy).toHaveBeenCalledWith({ theme: 'light', paperTint: 'sepia' })
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
    fireEvent.click(screen.getByRole('button', { name: /^← Back$/ }))
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

describe('themeChoice', () => {
  it('maps stored theme + paper to Light / Sepia / Dark', () => {
    expect(themeChoice({ theme: 'system', paperTint: 'white' })).toBe('light')
    expect(themeChoice({ theme: 'light', paperTint: 'cream' })).toBe('light')
    expect(themeChoice({ theme: 'light', paperTint: 'sepia' })).toBe('sepia')
    expect(themeChoice({ theme: 'dark', paperTint: 'cream' })).toBe('dark')
    expect(themeChoice({ theme: 'light', paperTint: 'dark' })).toBe('dark')
  })

  it('Look up: choose a site, a custom address is checked as you type, pick where pages open', async () => {
    render(<SettingsView onBack={() => {}} />)
    expect((screen.getByRole('radio', { name: 'Wikipedia' }) as HTMLInputElement).checked).toBe(
      true
    )
    expect(screen.getByRole('combobox', { name: 'Wikipedia language' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Google' }))
    expect(setSpy).toHaveBeenCalledWith({ lookupSite: 'google' })
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Wikipedia language' })).toBeNull()
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Custom site' }))
    const address = await screen.findByRole('textbox', { name: 'Custom site address' })
    fireEvent.change(address, { target: { value: 'https://www.bing.com/search' } })
    expect(screen.getByText(/Put {query} where/)).toBeTruthy()
    fireEvent.change(address, { target: { value: 'https://www.bing.com/search?q={query}' } })
    expect(
      screen.getByText('Looking up “ocean” opens https://www.bing.com/search?q=ocean')
    ).toBeTruthy()
    expect(setSpy).toHaveBeenLastCalledWith({
      lookupCustomUrl: 'https://www.bing.com/search?q={query}'
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Default browser' }))
    expect(setSpy).toHaveBeenCalledWith({ lookupOpenIn: 'browser' })
  })
})
