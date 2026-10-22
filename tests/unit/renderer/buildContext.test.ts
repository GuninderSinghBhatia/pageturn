import { describe, it, expect } from 'vitest'
import type { OutlineItem } from '@renderer/reader/pdf/pdfService'
import { buildExplainRequest, headingForPage } from '@renderer/help/buildContext'

/** A 10-page doc whose page n reads "page n text ... end of n", with page 3 ending long. */
const doc = {
  numPages: 10,
  outline: [] as OutlineItem[],
  getText: async (n: number) =>
    n === 3
      ? [
          { str: 'x'.repeat(1000), hasEOL: false },
          { str: 'END3', hasEOL: true }
        ]
      : [
          { str: `page ${n} text`, hasEOL: true },
          { str: `end of ${n}`, hasEOL: false }
        ]
}

describe('buildExplainRequest', () => {
  it('a selection across a spread uses both pages and the neighbours of the pair', async () => {
    const r = await buildExplainRequest(
      doc as never,
      { text: 'text end of 4 page 5', pages: [5, 4] },
      'Physics'
    )
    expect(r.pages).toEqual([4, 5])
    expect(r.pageText).toBe('page 4 text\nend of 4\n\npage 5 text\nend of 5')
    expect(r.prevTail.length).toBe(800)
    expect(r.prevTail.endsWith('END3')).toBe(true) // from page 3
    expect(r.nextHead).toBe('page 6 text\nend of 6')
    expect(r.selection).toBe('text end of 4 page 5')
    expect(r.bookTitle).toBe('Physics')
  })

  it('no previous page on page 1, no next page on the last page', async () => {
    expect(
      (await buildExplainRequest(doc as never, { text: 'a', pages: [1] }, null)).prevTail
    ).toBe('')
    expect(
      (await buildExplainRequest(doc as never, { text: 'a', pages: [10] }, null)).nextHead
    ).toBe('')
  })
})

describe('headingForPage', () => {
  const outline: OutlineItem[] = [
    {
      title: 'Part I',
      page: 1,
      children: [
        { title: 'Chapter 1', page: 2, children: [] },
        {
          title: 'Chapter 2',
          page: 10,
          children: [{ title: '2.1 Entropy', page: 12, children: [] }]
        }
      ]
    },
    { title: 'Part II', page: 40, children: [] }
  ]

  it('picks the deepest heading that starts on or before the page', () => {
    expect(headingForPage(outline, 13)).toBe('2.1 Entropy')
    expect(headingForPage(outline, 11)).toBe('Chapter 2')
    expect(headingForPage(outline, 1)).toBe('Part I')
    expect(headingForPage(outline, 45)).toBe('Part II')
    expect(headingForPage([], 3)).toBeNull()
  })
})
