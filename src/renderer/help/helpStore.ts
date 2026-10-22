import { create } from 'zustand'
import type { AiError, ExplainRequest, HelpDefaultTab } from '@shared/ai'
import type { Highlight, Rect } from '@shared/types'
import { useAnnotationStore } from '../stores/annotationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'

export type HelpTab = 'explain' | 'web'
export type HelpSelection = {
  text: string
  pages: number[]
  rects?: Record<number, Rect[]>
  /** Per-page text and rects, so the passage can be highlighted later (Save as note). */
  pieces?: { page: number; text: string; rects: Rect[] }[]
}
export type HelpMessage = { role: 'user' | 'assistant'; content: string; streaming?: boolean }
export type QuickKind = 'simpler' | 'detail' | 'example' | 'translate'

export const QUICK_PROMPTS = {
  simpler: (): string => "Explain that more simply, like I'm new to the topic.",
  detail: (): string => 'Go into more detail.',
  example: (): string => 'Give me a concrete example.',
  translate: (lang: string): string =>
    `Translate the selected passage into ${lang} and explain it in ${lang}.`
}

type OpenOptions = {
  hasKey: boolean
  defaultTab: HelpDefaultTab
  privacyAcknowledged: boolean
  buildRequest: () => Promise<ExplainRequest>
}

type HelpState = {
  open: boolean
  tab: HelpTab
  selection: HelpSelection | null
  requestId: string | null
  messages: HelpMessage[]
  error: AiError | null
  webQuery: string
  hasKey: boolean
  needsPrivacy: boolean
  openFor(sel: HelpSelection, opts: OpenOptions): void
  setTab(t: HelpTab): void
  setWebQuery(q: string): void
  close(): void
  ask(text: string): void
  quick(kind: QuickKind, lang?: string): void
  retry(): void
  acknowledgePrivacy(): void
  /** Highlights the passage (reusing an identical highlight) and keeps the last answer as its note. */
  saveAsNote(): Promise<void>
  receiveToken(e: { requestId: string; token: string }): void
  receiveDone(e: { requestId: string; text: string }): void
  receiveError(e: { requestId: string; error: AiError }): void
  reset(): void
}

const INITIAL = {
  open: false,
  tab: 'explain' as HelpTab,
  selection: null,
  requestId: null,
  messages: [] as HelpMessage[],
  error: null,
  webQuery: '',
  hasKey: false,
  needsPrivacy: false
}

const newId = (): string => crypto.randomUUID()

// Not state: builds the request for the current selection (needs the open PDF).
let buildRequest: (() => Promise<ExplainRequest>) | null = null
let privacyAcknowledged = true

/**
 * The Help panel: one explanation conversation (Explain tab) and a web search (Web tab) for
 * the passage the reader selected. Only events for the current requestId are applied, so an
 * old stream can never write into a newer panel.
 */
export const useHelpStore = create<HelpState>((set, get) => {
  /** Updates the trailing assistant message (the one being streamed). */
  const patchLast = (fn: (m: HelpMessage) => HelpMessage): void =>
    set((s) => {
      const messages = [...s.messages]
      const i = messages.length - 1
      if (i >= 0 && messages[i].role === 'assistant') messages[i] = fn(messages[i])
      return { messages }
    })

  const cancelCurrent = (): void => {
    const id = get().requestId
    if (id) void window.api.ai.cancel(id)
  }

  /** Starts a fresh explanation (new requestId). */
  const explain = async (): Promise<void> => {
    if (!buildRequest) return
    cancelCurrent()
    const id = newId()
    set({
      requestId: id,
      error: null,
      messages: [{ role: 'assistant', content: '', streaming: true }]
    })
    const req = await buildRequest()
    if (get().requestId !== id) return // superseded while building the context
    void window.api.ai.explain(id, req)
  }

  const startIfReady = (): void => {
    const s = get()
    if (!s.open || s.tab !== 'explain' || !s.hasKey || s.requestId) return
    if (!privacyAcknowledged) {
      set({ needsPrivacy: true })
      return
    }
    void explain()
  }

  return {
    ...INITIAL,

    openFor: (sel, opts) => {
      cancelCurrent()
      buildRequest = opts.buildRequest
      privacyAcknowledged = opts.privacyAcknowledged
      const tab: HelpTab =
        opts.defaultTab === 'auto' ? (opts.hasKey ? 'explain' : 'web') : opts.defaultTab
      set({
        ...INITIAL,
        open: true,
        tab,
        selection: sel,
        webQuery: sel.text.slice(0, 300),
        hasKey: opts.hasKey
      })
      startIfReady()
    },

    setTab: (tab) => {
      set({ tab })
      startIfReady()
    },

    setWebQuery: (webQuery) => set({ webQuery }),

    close: () => {
      cancelCurrent()
      void window.api.web.hide()
      buildRequest = null
      set({ ...INITIAL })
    },

    ask: (text) => {
      const s = get()
      const q = text.trim()
      if (!q || !s.requestId) return
      set({
        error: null,
        messages: [
          ...s.messages.map((m) => ({ ...m, streaming: false })),
          { role: 'user', content: q },
          { role: 'assistant', content: '', streaming: true }
        ]
      })
      void window.api.ai.followUp(s.requestId, q)
    },

    quick: (kind, lang = 'English') =>
      get().ask(kind === 'translate' ? QUICK_PROMPTS.translate(lang) : QUICK_PROMPTS[kind]()),

    retry: () => {
      const s = get()
      const answered = s.messages.some((m) => m.role === 'assistant' && m.content && !m.streaming)
      const lastUser = [...s.messages].reverse().find((m) => m.role === 'user')
      if (answered && lastUser && s.requestId) {
        // Re-ask the follow-up that failed: drop the failed reply and its question.
        set({ messages: s.messages.slice(0, s.messages.lastIndexOf(lastUser)) })
        get().ask(lastUser.content)
      } else {
        set({ requestId: null })
        void explain()
      }
    },

    acknowledgePrivacy: () => {
      privacyAcknowledged = true
      set({ needsPrivacy: false })
      void window.api.settings.set({ aiPrivacyAcknowledged: true })
      // Keep the app's copy in step so the next selection doesn't ask again.
      useSettingsStore.setState((st) => ({
        settings: { ...st.settings, aiPrivacyAcknowledged: true }
      }))
      startIfReady()
    },

    saveAsNote: async () => {
      const { selection, messages } = get()
      const answer = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)
      const pieces = selection?.pieces ?? []
      if (!answer || pieces.length === 0) return
      const annotations = useAnnotationStore.getState()
      const existing = Object.values(annotations.highlights)
      const same = (p: (typeof pieces)[number]): Highlight | undefined =>
        existing.find((h) => h.page === p.page && h.text.trim() === p.text.trim())
      const missing = pieces.filter((p) => !same(p))
      const created = missing.length
        ? annotations.addHighlights(missing.map((p) => ({ ...p, color: 'yellow' as const })))
        : []
      const first = same(pieces[0]) ?? created[0]
      if (!first) return
      const body = `**Explanation (AI):**

${answer.content}`
      const current = first.noteId ? useAnnotationStore.getState().notes[first.noteId] : undefined
      if (current?.body.includes(answer.content)) {
        useToastStore.getState().show('Already saved to notes')
        return
      }
      useAnnotationStore.getState().saveNote({
        id: current?.id,
        page: first.page,
        anchor: { highlightId: first.id },
        body: current?.body
          ? `${current.body}

${body}`
          : body
      })
      useToastStore.getState().show('Saved to notes')
    },

    receiveToken: ({ requestId, token }) => {
      if (requestId !== get().requestId) return
      patchLast((m) => ({ ...m, content: m.content + token, streaming: true }))
    },

    receiveDone: ({ requestId, text }) => {
      if (requestId !== get().requestId) return
      patchLast((m) => ({ ...m, content: text, streaming: false }))
    },

    receiveError: ({ requestId, error }) => {
      if (requestId !== get().requestId) return
      set((s) => ({
        error,
        messages: s.messages.filter((m) => !(m.role === 'assistant' && m.streaming && !m.content))
      }))
      patchLast((m) => ({ ...m, streaming: false }))
    },

    reset: () => {
      buildRequest = null
      privacyAcknowledged = true
      set({ ...INITIAL })
    }
  }
})

/** Routes main's AI events into the store; returns the unsubscribe function. */
export function connectHelpEvents(): () => void {
  const s = useHelpStore.getState()
  const offs = [
    window.api.ai.onToken(s.receiveToken),
    window.api.ai.onDone(s.receiveDone),
    window.api.ai.onError(s.receiveError)
  ]
  return () => offs.forEach((off) => off())
}
