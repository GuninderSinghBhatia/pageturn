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

describe('Gemini models', () => {
  it('offers the current generation, newest stable first', () => {
    const ids = MODEL_OPTIONS.gemini.map((m) => m.id)
    expect(ids[0]).toBe('gemini-3.8-flash')
    expect(ids).toEqual(
      expect.arrayContaining(['gemini-4-argon', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite'])
    )
  })

  it('the live list from a key keeps chat models only (no Live, TTS or image models)', () => {
    expect(
      chatModels('gemini', [
        'gemini-4-argon',
        'gemini-3.8-flash',
        'gemini-3.8-live',
        'gemini-3.8-flash-tts',
        'gemini-3.1-flash-image',
        'gemini-3.5-transcribe'
      ])
    ).toEqual(['gemini-3.8-flash', 'gemini-4-argon'])
  })
})
