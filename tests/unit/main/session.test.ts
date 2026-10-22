import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ChatMessage, ExplainRequest } from '@shared/ai'
import { AiSessionManager } from '../../../src/main/ai/session'
import { toAiError, type Provider } from '../../../src/main/ai/provider'

const req: ExplainRequest = {
  bookTitle: 'Physics',
  heading: null,
  selection: 'entropy',
  pages: [4],
  pageText: 'about entropy',
  prevTail: '',
  nextHead: ''
}

type Sent = { channel: string; payload: Record<string, unknown> }

/** Emits the given tokens, then resolves. Records what it was asked. */
type Call = { messages: ChatMessage[]; signal: AbortSignal; model: string; key: string }

function fakeProvider(
  tokens: string[],
  opts: { hang?: boolean } = {}
): { provider: Provider; calls: Call[] } {
  const calls: Call[] = []
  const provider: Provider = {
    id: 'mock',
    async stream(args, onToken) {
      calls.push({ ...args, messages: [...args.messages] })
      for (const t of tokens) {
        await new Promise((r) => setTimeout(r, 5))
        if (args.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        onToken(t)
      }
      if (opts.hang) {
        await new Promise((_, reject) =>
          args.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        )
      }
    },
    test: () => Promise.resolve()
  }
  return { provider, calls }
}

function manager(
  provider: Provider,
  opts: { key?: string | null; timeoutMs?: number } = {}
): { m: AiSessionManager; sent: Sent[] } {
  const sent: Sent[] = []
  const m = new AiSessionManager({
    secrets: { get: () => (opts.key === undefined ? 'sk-test' : opts.key) },
    settings: { get: () => ({ ...DEFAULT_SETTINGS }) },
    send: (channel, payload) => sent.push({ channel, payload: payload as Record<string, unknown> }),
    timeoutMs: opts.timeoutMs ?? 30_000,
    provider: () => provider
  })
  return { m, sent }
}

describe('AiSessionManager', () => {
  it('no key: one no_key error and no tokens', async () => {
    const { provider, calls } = fakeProvider(['a'])
    const { m, sent } = manager(provider, { key: null })
    await m.explain('req-00000001', req)
    expect(sent).toEqual([
      {
        channel: 'ai:error',
        payload: { requestId: 'req-00000001', error: expect.objectContaining({ kind: 'no_key' }) }
      }
    ])
    expect(calls).toHaveLength(0)
  })

  it('streams tokens in order, then done with the whole text; uses the default model', async () => {
    const { provider, calls } = fakeProvider(['Hel', 'lo', '!'])
    const { m, sent } = manager(provider)
    await m.explain('req-00000001', req)
    expect(sent.map((s) => s.channel)).toEqual(['ai:token', 'ai:token', 'ai:token', 'ai:done'])
    expect(sent.slice(0, 3).map((s) => s.payload.token)).toEqual(['Hel', 'lo', '!'])
    expect(sent[3].payload).toEqual({ requestId: 'req-00000001', text: 'Hello!' })
    expect(calls[0].model).toBe('claude-sonnet-5-5')
    expect(calls[0].key).toBe('sk-test')
  })

  it('a follow-up sends the history: user, assistant, user', async () => {
    const { provider, calls } = fakeProvider(['ok'])
    const { m } = manager(provider)
    await m.explain('req-00000001', req)
    await m.followUp('req-00000001', 'simpler please')
    expect(calls[1].messages.map((x) => x.role)).toEqual(['user', 'assistant', 'user'])
    expect(calls[1].messages[1].content).toBe('ok')
    expect(calls[1].messages[2].content).toBe('simpler please')
  })

  it('a follow-up to an unknown request is a provider error', async () => {
    const { provider } = fakeProvider(['ok'])
    const { m, sent } = manager(provider)
    await m.followUp('req-unknown1', 'hi')
    expect(sent[0]).toEqual({
      channel: 'ai:error',
      payload: { requestId: 'req-unknown1', error: expect.objectContaining({ kind: 'provider' }) }
    })
  })

  it('cancel mid-stream aborts the provider; no more tokens and no done', async () => {
    const { provider, calls } = fakeProvider(['a', 'b', 'c', 'd'])
    const { m, sent } = manager(provider)
    const run = m.explain('req-00000001', req)
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    m.cancel('req-00000001')
    await run
    expect(calls[0].signal.aborted).toBe(true)
    const after = sent.length
    await new Promise((r) => setTimeout(r, 40))
    expect(sent.length).toBe(after)
    expect(sent.some((s) => s.channel === 'ai:done' || s.channel === 'ai:error')).toBe(false)
  })

  it('a request that does not finish in time reports timeout', async () => {
    const { provider } = fakeProvider([], { hang: true })
    const { m, sent } = manager(provider, { timeoutMs: 50 })
    await m.explain('req-00000001', req)
    expect(sent).toEqual([
      {
        channel: 'ai:error',
        payload: { requestId: 'req-00000001', error: expect.objectContaining({ kind: 'timeout' }) }
      }
    ])
  })

  it('cancelAll stops every session', async () => {
    const { provider, calls } = fakeProvider(['a', 'b', 'c'])
    const { m } = manager(provider)
    const runs = [m.explain('req-00000001', req), m.explain('req-00000002', req)]
    m.cancelAll()
    await Promise.all(runs)
    expect(calls.every((c) => c.signal.aborted)).toBe(true)
  })
})

describe('toAiError', () => {
  it('maps statuses and network failures', () => {
    expect(toAiError({ status: 401 }).kind).toBe('invalid_key')
    expect(toAiError({ status: 403 }).kind).toBe('invalid_key')
    expect(toAiError({ status: 429 }).kind).toBe('rate_limit')
    expect(toAiError(new TypeError('fetch failed')).kind).toBe('offline')
    expect(toAiError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).kind).toBe('offline')
    expect(toAiError(new Error('boom')).kind).toBe('provider')
  })
})
