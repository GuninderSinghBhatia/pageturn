import type { ChatMessage, ExplainRequest } from '@shared/ai'

export const MAX_CONTEXT = 12_000

const SYSTEM = `You help someone who is reading a book and got stuck on a passage.
Explain the selected passage clearly and plainly, for a curious reader who is not an expert.
- Define any jargon or unusual terms you use or that appear in the passage.
- Give a short example or analogy when it helps.
- For math, code or logic, go step by step.
- If the passage is ambiguous, or the context is not enough to be sure, say so briefly.
- Use the surrounding page text only as context; focus on the selected part.
Keep it under about 250 words unless the reader asks for more. Use Markdown; use LaTeX ($...$) for math.`

const size = (r: ExplainRequest): number =>
  (r.bookTitle ?? '').length +
  (r.heading ?? '').length +
  r.selection.length +
  r.pageText.length +
  r.prevTail.length +
  r.nextHead.length

/** Cuts `text` to `budget` chars around the first occurrence of `focus` (or its start). */
function around(text: string, focus: string, budget: number): string {
  if (budget <= 0) return ''
  if (text.length <= budget) return text
  const at = Math.max(0, text.indexOf(focus))
  const start = Math.max(
    0,
    Math.min(at - Math.floor((budget - focus.length) / 2), text.length - budget)
  )
  return text.slice(start, start + budget)
}

/**
 * Keeps the request within MAX_CONTEXT characters. Drop order: the previous page's tail,
 * the next page's head, then the page text around the selection; a selection that alone
 * is too long is cut to MAX_CONTEXT - 200 characters plus "…".
 */
export function capContext(r: ExplainRequest): ExplainRequest {
  let out = { ...r }
  if (size(out) <= MAX_CONTEXT) return out
  out = { ...out, prevTail: '' }
  if (size(out) <= MAX_CONTEXT) return out
  out = { ...out, nextHead: '' }
  if (size(out) <= MAX_CONTEXT) return out

  const fixed = (out.bookTitle ?? '').length + (out.heading ?? '').length
  const limit = MAX_CONTEXT - 200
  if (out.selection.length > limit) {
    return { ...out, selection: `${out.selection.slice(0, limit)}…`, pageText: '' }
  }
  const budget = MAX_CONTEXT - fixed - out.selection.length
  return { ...out, pageText: around(out.pageText, out.selection, budget) }
}

/** System prompt and the first user message for an explanation. */
export function buildExplainMessages(r: ExplainRequest): {
  system: string
  messages: ChatMessage[]
} {
  const head = [r.bookTitle && `Book: ${r.bookTitle}`, r.heading && `Section: ${r.heading}`]
    .filter(Boolean)
    .join('\n')
  const content =
    (head ? `${head}\n\n` : '') +
    `<context_before>${r.prevTail}</context_before>\n` +
    `<page>${r.pageText}</page>\n` +
    `<context_after>${r.nextHead}</context_after>\n\n` +
    `I'm stuck on this part:\n<selection>${r.selection}</selection>\n\nExplain it.`
  return { system: SYSTEM, messages: [{ role: 'user', content }] }
}
