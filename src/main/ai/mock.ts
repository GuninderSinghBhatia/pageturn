import type { Provider, StreamArgs } from './provider'

const TOKEN_CHARS = 5
const TOKEN_MS = 20

/** Deterministic stand-in used by tests and demos (PAGETURN_AI_MOCK=1). */
export class MockProvider implements Provider {
  id = 'mock' as const

  async stream(args: StreamArgs, onToken: (t: string) => void): Promise<void> {
    const last = args.messages[args.messages.length - 1]?.content ?? ''
    const selection = /<selection>([\s\S]*?)<\/selection>/.exec(last)?.[1]
    if ((selection ?? last).includes('__FAIL_RATE__')) {
      throw Object.assign(new Error('rate limited'), { status: 429 })
    }
    const text = selection
      ? `Mock explanation of: ${selection.slice(0, 40)}`
      : `Mock answer to: ${last.slice(0, 40)}`
    for (let i = 0; i < text.length; i += TOKEN_CHARS) {
      await new Promise((r) => setTimeout(r, TOKEN_MS))
      if (args.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      onToken(text.slice(i, i + TOKEN_CHARS))
    }
  }

  async test(key: string): Promise<void> {
    if (!key.startsWith('sk-')) throw Object.assign(new Error('bad key'), { status: 401 })
  }
}
