import Anthropic from '@anthropic-ai/sdk'
import type { Provider, StreamArgs } from './provider'

/**
 * Models that accept server-side refusal fallbacks (`fallbacks: "default"`): if a safety
 * classifier declines, the API re-runs the request on Anthropic's recommended model instead
 * of returning a refusal. Other (user-typed) models are sent without it.
 */
const FALLBACK_MODELS = new Set([
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1'
])

const client = (key: string): Anthropic => new Anthropic({ apiKey: key, maxRetries: 1 })

export class AnthropicProvider implements Provider {
  id = 'anthropic' as const

  async stream(args: StreamArgs, onToken: (t: string) => void): Promise<void> {
    const fallback = FALLBACK_MODELS.has(args.model)
    const params = {
      model: args.model,
      max_tokens: 1024,
      system: args.system,
      messages: args.messages,
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {})
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming
    const stream = client(args.key).beta.messages.stream(params, { signal: args.signal })
    stream.on('text', (t) => onToken(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      throw new Error('The model declined to explain this passage.')
    }
  }

  async test(key: string, model: string): Promise<void> {
    await client(key).messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with OK.' }]
    })
  }
}
