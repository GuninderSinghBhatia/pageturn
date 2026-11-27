// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { PRIVACY_LINE, type ChatGptStatus, type ClaudeStatus } from '@shared/ai'
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
    listModels: vi.fn(async (): Promise<string[]> => []),
    claudeStatus: vi.fn(async (): Promise<ClaudeStatus> => ({ installed: false, loggedIn: false })),
    claudeLogin: vi.fn(async () => undefined),
    chatgptStatus: vi.fn(async (): Promise<ChatGptStatus> => signedOut),
    chatgptLogin: vi.fn(),
    chatgptLogout: vi.fn(async () => ({ confirmed: true })),
    chatgptModels: vi.fn(async () => [{ id: 'gpt-x', label: 'GPT X' }]),
    chatgptWelcomed: vi.fn(async () => undefined),
    chatgptOpenUsage: vi.fn(async () => undefined)
  }
}

const signedOut: ChatGptStatus = { signedIn: false, planUse: false, email: null, welcomed: false }
const signedIn: ChatGptStatus = { signedIn: true, planUse: true, email: 'r@x.org', welcomed: false }

function useChatGpt(): void {
  stored = { ...DEFAULT_SETTINGS, aiProvider: 'chatgpt' }
  useSettingsStore.setState({ settings: stored, loaded: true })
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
  it('ChatGPT plan: Continue with ChatGPT signs in, then the one-time notice and account models', async () => {
    useChatGpt()
    api.ai.chatgptLogin.mockResolvedValueOnce({ ok: true, status: signedIn })
    render(<AiSettings />)
    expect(screen.queryByLabelText('API key')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    await waitFor(() => expect(api.ai.chatgptLogin).toHaveBeenCalledWith(false))
    expect(await screen.findByText(/Using ChatGPT plan \(r@x.org\)/)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: "You're using your ChatGPT plan" })).toBeTruthy()

    const model = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    await waitFor(() => expect([...model.options].map((o) => o.value)).toContain('gpt-x'))
    expect([...model.options].find((o) => o.value === 'gpt-x')?.text).toBe('GPT X')

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(api.ai.chatgptWelcomed).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage usage' }))
    expect(api.ai.chatgptOpenUsage).toHaveBeenCalled()
  })

  it('ChatGPT plan: a declined permission offers to allow it; sign-in errors are shown', async () => {
    useChatGpt()
    api.ai.chatgptStatus.mockResolvedValueOnce({ ...signedIn, planUse: false })
    api.ai.chatgptLogin.mockResolvedValueOnce({
      ok: false,
      error: 'Sign-in was cancelled.',
      status: { ...signedIn, planUse: false }
    })
    render(<AiSettings />)
    expect(await screen.findByText(/doesn.t have permission/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Allow plan use' }))
    await waitFor(() => expect(api.ai.chatgptLogin).toHaveBeenCalledWith(true))
    expect(await screen.findByText('Sign-in was cancelled.')).toBeTruthy()
  })

  it('ChatGPT plan: sign out reports when OpenAI could not be told', async () => {
    useChatGpt()
    api.ai.chatgptStatus
      .mockResolvedValueOnce({ ...signedIn, welcomed: true })
      .mockResolvedValueOnce(signedOut)
    api.ai.chatgptLogout.mockResolvedValueOnce({ confirmed: false })
    render(<AiSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText(/couldn't be told/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeTruthy()
  })

  it('Claude plan: no key box; shows Claude Code status and offers sign-in', async () => {
    stored = { ...DEFAULT_SETTINGS, aiProvider: 'claude' }
    useSettingsStore.setState({ settings: stored, loaded: true })
    const signedOut: ClaudeStatus = {
      installed: true,
      version: '2.1.292',
      loggedIn: false,
      authMethod: null,
      plan: null
    }
    api.ai.claudeStatus.mockResolvedValueOnce(signedOut)
    render(<AiSettings />)
    expect(screen.queryByLabelText('API key')).toBeNull()
    expect(api.settings.hasApiKey).not.toHaveBeenCalled()
    expect(await screen.findByText(/installed but not signed in/)).toBeTruthy()
    const model = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    expect(model.value).toBe('default')
    expect([...model.options].map((o) => o.value)).toEqual(['default', 'sonnet', 'opus', 'haiku'])

    api.ai.claudeStatus.mockResolvedValueOnce({ ...signedOut, loggedIn: true, plan: 'max' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(api.ai.claudeLogin).toHaveBeenCalled())
    expect(await screen.findByText(/Finish signing in/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/Signed in to Claude Code 2.1.292 \(max plan\)/)).toBeTruthy()
  })

  it('Claude plan: says when Claude Code is not installed', async () => {
    stored = { ...DEFAULT_SETTINGS, aiProvider: 'claude' }
    useSettingsStore.setState({ settings: stored, loaded: true })
    render(<AiSettings />)
    expect(await screen.findByText(/not installed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

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
