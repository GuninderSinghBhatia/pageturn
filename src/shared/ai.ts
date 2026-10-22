import { z } from 'zod'

/** AI providers the reader can use with their own API key. */
export const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini'
}

/** Model used when the reader has not typed one of their own. */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-pro'
}

/** Models offered in Settings (first = default). Keys can unlock more, listed live. */
export const MODEL_OPTIONS: Record<ProviderId, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — recommended' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, lowest cost' }
  ],
  openai: [
    { id: 'gpt-5', label: 'GPT-5 — recommended' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini — faster, lower cost' },
    { id: 'gpt-5-nano', label: 'GPT-5 nano — fastest, lowest cost' }
  ],
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — recommended' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — faster, lower cost' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — fastest, lowest cost' }
  ]
}

/** Of a provider's model list, the ones that can chat (no embeddings, audio, images…). */
export function chatModels(p: ProviderId, ids: string[]): string[] {
  const keep: Record<ProviderId, RegExp> = {
    anthropic: /^claude-/,
    openai: /^(gpt-|o\d|chatgpt-)/,
    gemini: /^gemini-/
  }
  const skip =
    /(embed|audio|tts|transcribe|whisper|image|dall-e|realtime|search|moderation|vision|live|preview-tts|aqa|instruct)/i
  return [...new Set(ids)].filter((id) => keep[p].test(id) && !skip.test(id)).sort()
}

export const SEARCH_ENGINES = ['duckduckgo', 'google', 'bing'] as const
export type SearchEngine = (typeof SEARCH_ENGINES)[number]
export const HELP_TABS = ['auto', 'explain', 'web'] as const
export type HelpDefaultTab = (typeof HELP_TABS)[number]

export const PRIVACY_LINE =
  'Only the text you select and nearby page text are sent to your chosen AI provider, and only when you click Explain.'

export type AiErrorKind =
  'no_key' | 'invalid_key' | 'rate_limit' | 'offline' | 'timeout' | 'provider'
export type AiError = { kind: AiErrorKind; message: string }

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

/** What the renderer sends for an explanation: the selection plus nearby text. */
export type ExplainRequest = {
  bookTitle: string | null
  heading: string | null
  selection: string
  pages: number[]
  pageText: string
  prevTail: string
  nextHead: string
}

export const ProviderSchema = z.enum(PROVIDERS)
export const ApiKeySchema = z.string().trim().min(1).max(512)
export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)
export const FollowUpSchema = z.string().trim().min(1).max(4000)
export const ExplainRequestSchema = z
  .object({
    bookTitle: z.string().max(500).nullable(),
    heading: z.string().max(500).nullable(),
    selection: z.string().min(1).max(100_000),
    pages: z.array(z.number().int().min(1)).min(1).max(4),
    pageText: z.string().max(400_000),
    prevTail: z.string().max(10_000),
    nextHead: z.string().max(10_000)
  })
  .strict()
