import type { AiError, ChatMessage, ProviderId } from '@shared/ai'
import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { MockProvider } from './mock'
import { OpenAiProvider } from './openai'

export type StreamArgs = {
  key: string
  model: string
  system: string
  messages: ChatMessage[]
  signal: AbortSignal
}

/** One AI service. Runs only in main; keys never reach the renderer. */
export interface Provider {
  id: ProviderId | 'mock'
  /** Streams the reply token by token; rejects with the provider's error (see toAiError). */
  stream(args: StreamArgs, onToken: (t: string) => void): Promise<void>
  /** Model ids this key can use (unfiltered). */
  listModels(key: string): Promise<string[]>
  /** Cheapest call that proves the key works. */
  test(key: string, model: string): Promise<void>
}

/** The provider for an id; the mock when PAGETURN_AI_MOCK=1 (tests, demos). */
export function getProvider(id: ProviderId): Provider {
  if (process.env.PAGETURN_AI_MOCK === '1') return new MockProvider()
  if (id === 'openai') return new OpenAiProvider()
  if (id === 'gemini') return new GeminiProvider()
  return new AnthropicProvider()
}

const MESSAGES: Record<AiError['kind'], string> = {
  no_key: 'Add an API key in Settings to get explanations.',
  invalid_key: 'The API key was rejected. Check it in Settings.',
  rate_limit: 'The AI provider is rate limiting requests. Try again in a moment.',
  offline: 'Could not reach the AI provider. Check your internet connection.',
  timeout: 'The AI provider took too long to answer.',
  provider: 'The AI provider returned an error.'
}

export const aiError = (kind: AiError['kind'], message = MESSAGES[kind]): AiError => ({
  kind,
  message
})

/** Maps SDK / network errors to the kinds the panel knows how to explain. */
export function toAiError(e: unknown): AiError {
  const err = (e ?? {}) as { status?: number; code?: string; name?: string; message?: string }
  const status = err.status
  if (status === 401 || status === 403) return aiError('invalid_key')
  if (/API_KEY_INVALID|API key not valid|invalid[ _]api[ _]key/i.test(String(err.message ?? ''))) {
    return aiError('invalid_key') // e.g. Gemini answers a bad key with 400 INVALID_ARGUMENT
  }
  if (status === 429) return aiError('rate_limit')
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return aiError('timeout')
  const msg = String(err.message ?? '')
  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT'].includes(
      err.code ?? ''
    ) ||
    /fetch failed|network|getaddrinfo|connection error/i.test(msg)
  ) {
    return aiError('offline')
  }
  if (typeof status === 'number' && status >= 500) {
    return aiError('provider', 'The AI provider is having trouble right now. Try again shortly.')
  }
  return aiError('provider', msg ? `The AI provider returned an error: ${msg}` : MESSAGES.provider)
}
