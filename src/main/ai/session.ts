import { DEFAULT_MODELS, type ChatMessage, type ExplainRequest, type ProviderId } from '@shared/ai'
import type { Settings } from '@shared/types'
import { buildExplainMessages, capContext } from './prompt'
import { aiError, getProvider, toAiError, type Provider } from './provider'

type Session = { system: string; messages: ChatMessage[]; controller: AbortController | null }

export type SessionDeps = {
  secrets: { get(p: ProviderId): string | null }
  settings: { get(): Settings }
  send: (channel: string, payload: unknown) => void
  timeoutMs?: number
  /** Injected in tests; defaults to the real provider for the id. */
  provider?: (id: ProviderId) => Provider
}

/**
 * One conversation per requestId: the explanation and its follow-ups. Streams tokens to the
 * renderer as `ai:token`, then `ai:done` or `ai:error`. A cancelled request sends nothing
 * more, so tokens can never land in a panel that moved on.
 */
export class AiSessionManager {
  private sessions = new Map<string, Session>()
  private timeoutMs: number
  private provider: (id: ProviderId) => Provider

  constructor(private deps: SessionDeps) {
    this.timeoutMs = deps.timeoutMs ?? 30_000
    this.provider = deps.provider ?? getProvider
  }

  async explain(requestId: string, req: ExplainRequest): Promise<void> {
    this.cancel(requestId)
    const { system, messages } = buildExplainMessages(capContext(req))
    this.sessions.set(requestId, { system, messages, controller: null })
    await this.run(requestId)
  }

  async followUp(requestId: string, text: string): Promise<void> {
    const s = this.sessions.get(requestId)
    if (!s) {
      this.deps.send('ai:error', {
        requestId,
        error: aiError('provider', 'This conversation has ended. Ask again from the page.')
      })
      return
    }
    s.controller?.abort()
    s.messages.push({ role: 'user', content: text })
    await this.run(requestId)
  }

  cancel(requestId: string): void {
    const s = this.sessions.get(requestId)
    if (!s) return
    s.controller?.abort()
    this.sessions.delete(requestId)
  }

  cancelAll(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id)
  }

  private async run(requestId: string): Promise<void> {
    const s = this.sessions.get(requestId)!
    const settings = this.deps.settings.get()
    const key = this.deps.secrets.get(settings.aiProvider)
    if (!key) {
      this.deps.send('ai:error', { requestId, error: aiError('no_key') })
      return
    }
    const controller = new AbortController()
    s.controller = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    // Still the live request for this id? (Not cancelled, not superseded by a follow-up.)
    const live = (): boolean =>
      this.sessions.get(requestId) === s &&
      s.controller === controller &&
      !controller.signal.aborted
    let text = ''
    try {
      await this.provider(settings.aiProvider).stream(
        {
          key,
          model: settings.aiModel || DEFAULT_MODELS[settings.aiProvider],
          system: s.system,
          messages: [...s.messages],
          signal: controller.signal
        },
        (token) => {
          if (!live()) return
          text += token
          this.deps.send('ai:token', { requestId, token })
        }
      )
      if (!live()) return
      s.messages.push({ role: 'assistant', content: text })
      this.deps.send('ai:done', { requestId, text })
    } catch (err) {
      if (timedOut && this.sessions.get(requestId) === s) {
        this.deps.send('ai:error', { requestId, error: aiError('timeout') })
      } else if (live()) {
        this.deps.send('ai:error', { requestId, error: toAiError(err) })
      }
    } finally {
      clearTimeout(timer)
      if (s.controller === controller) s.controller = null
    }
  }
}
