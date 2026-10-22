import { GoogleGenAI } from '@google/genai'
import type { Provider, StreamArgs } from './provider'

export class GeminiProvider implements Provider {
  id = 'gemini' as const

  async stream(args: StreamArgs, onToken: (t: string) => void): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: args.key })
    const stream = await ai.models.generateContentStream({
      model: args.model,
      contents: args.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      config: { systemInstruction: args.system, abortSignal: args.signal }
    })
    for await (const chunk of stream) {
      const t = chunk.text
      if (t) onToken(t)
    }
  }

  async listModels(key: string): Promise<string[]> {
    const ids: string[] = []
    const pager = await new GoogleGenAI({ apiKey: key }).models.list()
    for await (const m of pager) {
      if (m.name && (m.supportedActions ?? ['generateContent']).includes('generateContent')) {
        ids.push(m.name.replace(/^models\//, ''))
      }
    }
    return ids
  }

  async test(key: string, model: string): Promise<void> {
    await new GoogleGenAI({ apiKey: key }).models.get({ model })
  }
}
