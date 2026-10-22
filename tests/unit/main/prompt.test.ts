import { describe, it, expect } from 'vitest'
import type { ExplainRequest } from '@shared/ai'
import { buildExplainMessages, capContext, MAX_CONTEXT } from '../../../src/main/ai/prompt'

const req = (over: Partial<ExplainRequest> = {}): ExplainRequest => ({
  bookTitle: 'Physics',
  heading: 'Entropy',
  selection: 'the arrow of time',
  pages: [4],
  pageText: 'Before. the arrow of time. After.',
  prevTail: 'tail of page 3',
  nextHead: 'head of page 5',
  ...over
})

const total = (r: ExplainRequest): number =>
  (r.bookTitle ?? '').length +
  (r.heading ?? '').length +
  r.selection.length +
  r.pageText.length +
  r.prevTail.length +
  r.nextHead.length

describe('capContext', () => {
  it('leaves a small request alone', () => {
    expect(capContext(req())).toEqual(req())
  })

  it('a 20k-char page is cut to fit around the selection', () => {
    const pageText = `${'a'.repeat(10_000)} the arrow of time ${'b'.repeat(10_000)}`
    const r = capContext(req({ pageText }))
    expect(total(r)).toBeLessThanOrEqual(MAX_CONTEXT)
    expect(r.pageText).toContain('the arrow of time')
    expect(r.prevTail).toBe('') // neighbours go first
    expect(r.nextHead).toBe('')
  })

  it('a 15k-char selection is truncated with … and the context dropped (still sent)', () => {
    const selection = 'x'.repeat(15_000)
    const r = capContext(req({ selection, pageText: selection }))
    expect(r.selection.endsWith('…')).toBe(true)
    expect(r.selection.length).toBeLessThanOrEqual(MAX_CONTEXT - 200 + 1)
    expect(r.prevTail).toBe('')
    expect(r.nextHead).toBe('')
    expect(total(r)).toBeLessThanOrEqual(MAX_CONTEXT)
  })
})

describe('buildExplainMessages', () => {
  it('the system prompt asks for a clear, short, step-by-step explanation', () => {
    const { system } = buildExplainMessages(req())
    expect(system).toMatch(/define/i)
    expect(system).toMatch(/step by step/i)
    expect(system).toMatch(/250 words/)
  })

  it('the user message carries book, section, context and the selection', () => {
    const { messages } = buildExplainMessages(req())
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe(
      'Book: Physics\nSection: Entropy\n\n<context_before>tail of page 3</context_before>\n' +
        '<page>Before. the arrow of time. After.</page>\n<context_after>head of page 5</context_after>\n\n' +
        "I'm stuck on this part:\n<selection>the arrow of time</selection>\n\nExplain it."
    )
  })

  it('omits the Book and Section lines when unknown', () => {
    const { messages } = buildExplainMessages(req({ bookTitle: null, heading: null }))
    expect(messages[0].content.startsWith('<context_before>')).toBe(true)
  })
})
