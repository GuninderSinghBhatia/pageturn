// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExplainRequest } from '@shared/ai'
import { QUICK_PROMPTS, useHelpStore } from '@renderer/help/helpStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

const req: ExplainRequest = {
  bookTitle: null,
  heading: null,
  selection: 'entropy',
  pages: [3],
  pageText: 'p',
  prevTail: '',
  nextHead: ''
}
const sel = { text: 'entropy', pages: [3] }
const api = {
  ai: {
    explain: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    cancel: vi.fn(async () => {})
  },
  web: { hide: vi.fn(async () => {}) },
  settings: { set: vi.fn(async () => ({})) }
}
type OpenOpts = Parameters<ReturnType<typeof useHelpStore.getState>['openFor']>[1]
const opts = (over: Partial<OpenOpts> = {}): OpenOpts => ({
  hasKey: true,
  defaultTab: 'auto' as const,
  privacyAcknowledged: true,
  buildRequest: async () => req,
  ...over
})
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  Object.values(api.ai).forEach((f) => f.mockClear())
  api.web.hide.mockClear()
  window.api = api as unknown as typeof window.api
  useHelpStore.getState().reset()
})

describe('helpStore', () => {
  it('auto opens on Web without a key, on Explain with one (and starts explaining)', async () => {
    useHelpStore.getState().openFor(sel, opts({ hasKey: false }))
    expect(useHelpStore.getState().tab).toBe('web')
    expect(useHelpStore.getState().webQuery).toBe('entropy')
    expect(api.ai.explain).not.toHaveBeenCalled()

    useHelpStore.getState().openFor(sel, opts())
    expect(useHelpStore.getState().tab).toBe('explain')
    await flush()
    const id = useHelpStore.getState().requestId!
    expect(api.ai.explain).toHaveBeenCalledWith(id, req)
  })

  it('opening again cancels the previous request', async () => {
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    const first = useHelpStore.getState().requestId
    useHelpStore.getState().openFor({ text: 'other', pages: [4] }, opts())
    await flush()
    expect(api.ai.cancel).toHaveBeenCalledWith(first)
    expect(useHelpStore.getState().requestId).not.toBe(first)
  })

  it('streams tokens into the answer; tokens for a stale request are ignored', async () => {
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    const id = useHelpStore.getState().requestId!
    const s = useHelpStore.getState()
    s.receiveToken({ requestId: id, token: 'Hel' })
    s.receiveToken({ requestId: 'stale-request', token: 'XX' })
    s.receiveToken({ requestId: id, token: 'lo' })
    s.receiveDone({ requestId: id, text: 'Hello' })
    const last = useHelpStore.getState().messages.at(-1)!
    expect(last).toEqual({ role: 'assistant', content: 'Hello', streaming: false })
  })

  it('close cancels the request and hides the web view', async () => {
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    const id = useHelpStore.getState().requestId
    useHelpStore.getState().close()
    expect(api.ai.cancel).toHaveBeenCalledWith(id)
    expect(api.web.hide).toHaveBeenCalled()
    expect(useHelpStore.getState().open).toBe(false)
  })

  it('quick actions send their exact prompt as a follow-up', async () => {
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    const id = useHelpStore.getState().requestId!
    useHelpStore.getState().receiveDone({ requestId: id, text: 'answer' })
    useHelpStore.getState().quick('simpler')
    expect(api.ai.followUp).toHaveBeenCalledWith(
      id,
      "Explain that more simply, like I'm new to the topic."
    )
    useHelpStore.getState().quick('translate', 'Punjabi')
    expect(QUICK_PROMPTS.translate('Punjabi')).toBe(
      'Translate the selected passage into Punjabi and explain it in Punjabi.'
    )
    expect(api.ai.followUp).toHaveBeenLastCalledWith(id, QUICK_PROMPTS.translate('Punjabi'))
  })

  it('an error is shown and Retry runs the explanation again', async () => {
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    const id = useHelpStore.getState().requestId!
    useHelpStore
      .getState()
      .receiveError({ requestId: id, error: { kind: 'rate_limit', message: 'slow down' } })
    expect(useHelpStore.getState().error?.kind).toBe('rate_limit')
    useHelpStore.getState().retry()
    await flush()
    expect(useHelpStore.getState().error).toBeNull()
    expect(api.ai.explain).toHaveBeenCalledTimes(2)
  })

  it('first use waits for the privacy notice before sending anything', async () => {
    useHelpStore.getState().openFor(sel, opts({ privacyAcknowledged: false }))
    await flush()
    expect(useHelpStore.getState().needsPrivacy).toBe(true)
    expect(api.ai.explain).not.toHaveBeenCalled()
    useHelpStore.getState().acknowledgePrivacy()
    await flush()
    expect(api.settings.set).toHaveBeenCalledWith({ aiPrivacyAcknowledged: true })
    expect(api.ai.explain).toHaveBeenCalledTimes(1)
    // remembered app-wide, so the next selection does not ask again
    expect(useSettingsStore.getState().settings.aiPrivacyAcknowledged).toBe(true)
  })

  it('a request main refuses shows as an error instead of thinking forever', async () => {
    api.ai.explain.mockRejectedValueOnce(new Error('Invalid payload'))
    useHelpStore.getState().openFor(sel, opts())
    await flush()
    await flush()
    expect(useHelpStore.getState().error?.kind).toBe('provider')
    expect(useHelpStore.getState().messages.some((m) => m.streaming)).toBe(false)
  })
})
