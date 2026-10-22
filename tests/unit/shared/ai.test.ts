import { describe, it, expect } from 'vitest'
import { chatModels, DEFAULT_MODELS, MODEL_OPTIONS } from '@shared/ai'

describe('model lists', () => {
  it('each provider lists its default model first', () => {
    for (const p of ['anthropic', 'openai', 'gemini'] as const) {
      expect(MODEL_OPTIONS[p][0].id).toBe(DEFAULT_MODELS[p])
    }
  })

  it('keeps chat models and drops embeddings, audio, images and the like', () => {
    expect(
      chatModels('openai', [
        'gpt-5',
        'o3',
        'text-embedding-3-large',
        'gpt-4o-audio-preview',
        'gpt-image-1',
        'whisper-1',
        'gpt-5'
      ])
    ).toEqual(['gpt-5', 'o3'])
    expect(
      chatModels('gemini', ['gemini-2.5-pro', 'text-embedding-004', 'gemini-2.5-flash-preview-tts'])
    ).toEqual(['gemini-2.5-pro'])
    expect(chatModels('anthropic', ['claude-opus-5-5', 'something-else'])).toEqual([
      'claude-opus-5-5'
    ])
  })
})
