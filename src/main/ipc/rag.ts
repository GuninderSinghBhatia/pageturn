import { ipcMain } from 'electron'
import { z } from 'zod'
import { Channels, RagCurrentPageSchema, RagQuestionSchema, type RagAnswer } from '@shared/ipc'
import { parse } from './validate'

const RAG_URL = 'http://localhost:8000'
const UNREACHABLE = 'rag-service is not reachable on localhost:8000'

const AskResponseSchema = z.object({
  answer: z.string(),
  context_pages: z.array(z.number().int().positive())
})

// The renderer never talks to the service directly (no CORS to configure, one place for all calls).
export function registerRagIpc(): void {
  ipcMain.handle(Channels.ragHealth, async () => {
    try {
      const res = await fetch(`${RAG_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      return { ok: true as const, body: (await res.json()) as unknown }
    } catch {
      return { ok: false as const, error: UNREACHABLE }
    }
  })

  ipcMain.handle(Channels.ragAsk, async (_e, question: unknown, currentPage: unknown): Promise<RagAnswer> => {
    const q = parse(RagQuestionSchema, question)
    const page = parse(RagCurrentPageSchema, currentPage)
    try {
      // Retrieval + an LLM call: allow far longer than a health check.
      const res = await fetch(`${RAG_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, current_page: page }),
        signal: AbortSignal.timeout(60_000)
      })
      if (!res.ok) return { ok: false, error: `rag-service answered HTTP ${res.status}` }
      const body = AskResponseSchema.safeParse(await res.json())
      if (!body.success) return { ok: false, error: 'rag-service sent an unexpected reply' }
      const pages = [...new Set(body.data.context_pages)].sort((a, b) => a - b)
      return { ok: true, answer: body.data.answer, pages }
    } catch {
      return { ok: false, error: UNREACHABLE }
    }
  })
}
