import OpenAI from 'openai'
import type { Provider, StreamArgs } from './provider'

const client = (key: string): OpenAI => new OpenAI({ apiKey: key, maxRetries: 1 })

export class OpenAiProvider implements Provider {
  id = 'openai' as const

  async stream(args: StreamArgs, onToken: (t: string) => void): Promise<void> {
    const stream = await client(args.key).chat.completions.create(
      {
        model: args.model,
        stream: true,
        messages: [{ role: 'system', content: args.system }, ...args.messages]
      },
      { signal: args.signal }
    )
    for await (const chunk of stream) {
      const t = chunk.choices[0]?.delta?.content
      if (t) onToken(t)
    }
  }

  async test(key: string): Promise<void> {
    await client(key).models.list()
  }
}
