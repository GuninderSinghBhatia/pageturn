// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { PRIVACY_LINE } from '@shared/ai'
import { AiSettings } from '@renderer/settings/AiSettings'
import { useSettingsStore } from '@renderer/stores/settingsStore'

let stored: Settings
const keys = new Set<string>()
const api = {
  settings: {
    get: vi.fn(async () => stored),
    set: vi.fn(async (p: Partial<Settings>) => (stored = { ...stored, ...p })),
    setApiKey: vi.fn(async (p: string) => void keys.add(p)),
    hasApiKey: vi.fn(async (p: string) => keys.has(p)),
    clearApiKey: vi.fn(async (p: string) => void keys.delete(p))
  },
  ai: {
    testKey: vi.fn(async () => ({ ok: true as const })),
    listModels: vi.fn(async (): Promise<string[]> => [])
  }
}

beforeEach(() => {
  stored = { ...DEFAULT_SETTINGS }
  keys.clear()
  Object.values(api.settings).forEach((f) => f.mockClear())
  window.api = api as unknown as typeof window.api
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
})
afterEach(cleanup)

describe('AiSettings', () => {
  it('saves a key without ever showing it, then reports it as saved', async () => {
    render(<AiSettings />)
    const input = screen.getByLabelText('API key') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'sk-ant-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() =>
      expect(api.settings.setApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-123')
    )
    expect(await screen.findByText(/Key saved/)).toBeTruthy()
    expect(input.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }))
    expect(await screen.findByText(/Key works/)).toBeTruthy()
  })

  it('the model is picked from a list for the chosen provider (no typing); privacy line is shown', async () => {
    render(<AiSettings />)
    expect(screen.getByText(PRIVACY_LINE)).toBeTruthy()
    const model = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    expect(model.tagName).toBe('SELECT')
    expect(model.value).toBe('claude-sonnet-5-5')
    expect([...model.options].map((o) => o.value)).toContain('claude-opus-5-5')
    fireEvent.change(model, { target: { value: 'claude-opus-5-5' } })
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({ aiModel: 'claude-opus-5-5' })
    )

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({ aiProvider: 'openai', aiModel: null })
    )
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe(
        'gpt-5'
      )
    )
  })

  it('with a saved key, the list also offers the models that key can use', async () => {
    keys.add('anthropic')
    api.ai.listModels.mockResolvedValueOnce(['claude-sonnet-5-5', 'claude-fable-5-1'])
    render(<AiSettings />)
    await waitFor(() =>
      expect(
        [...(screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).options].map(
          (o) => o.value
        )
      ).toContain('claude-fable-5-1')
    )
    expect(api.ai.listModels).toHaveBeenCalledWith('anthropic')
  })

  it('explains when secure storage is unavailable', async () => {
    api.settings.setApiKey.mockRejectedValueOnce(
      new Error('Secure storage unavailable on this system')
    )
    render(<AiSettings />)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText(/Secure storage unavailable/)).toBeTruthy()
  })

  it('search engine, include title and default tab are saved', async () => {
    render(<AiSettings />)
    fireEvent.change(screen.getByLabelText('Search engine'), { target: { value: 'bing' } })
    fireEvent.click(screen.getByLabelText('Include the book title in searches'))
    fireEvent.change(screen.getByLabelText('Help opens on'), { target: { value: 'web' } })
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ helpDefaultTab: 'web' }))
    expect(api.settings.set).toHaveBeenCalledWith({ searchEngine: 'bing' })
    expect(api.settings.set).toHaveBeenCalledWith({ searchIncludeTitle: true })
  })
})
