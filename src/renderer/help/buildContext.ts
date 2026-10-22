import type { ExplainRequest } from '@shared/ai'
import type { OpenedDoc, OutlineItem } from '../reader/pdf/pdfService'

export const NEIGHBOR_CHARS = 800

type TextSource = Pick<OpenedDoc, 'numPages' | 'outline' | 'getText'>

/** A page's text in reading order, with line breaks where the PDF ends lines. */
async function pageText(doc: TextSource, page: number): Promise<string> {
  if (page < 1 || page > doc.numPages) return ''
  const items = await doc.getText(page)
  return items
    .map((it) => it.str + (it.hasEOL ? '\n' : ''))
    .join('')
    .trim()
}

/** Deepest outline heading that starts on or before `page`, in document order. */
export function headingForPage(outline: OutlineItem[], page: number): string | null {
  let found: string | null = null
  const walk = (items: OutlineItem[]): void => {
    for (const it of items) {
      if (it.page === null || it.page > page) continue
      found = it.title
      walk(it.children)
    }
  }
  walk(outline)
  return found
}

/**
 * The context sent with an explanation: the selection, the full text of the page(s) it is
 * on, the end of the page before and the start of the page after, plus title and heading.
 * (Main caps the total, see capContext.)
 */
export async function buildExplainRequest(
  doc: TextSource,
  selection: { text: string; pages: number[] },
  bookTitle: string | null
): Promise<ExplainRequest> {
  const pages = [...new Set(selection.pages)].sort((a, b) => a - b)
  const first = pages[0]
  const last = pages[pages.length - 1]
  const [texts, prev, next] = await Promise.all([
    Promise.all(pages.map((p) => pageText(doc, p))),
    pageText(doc, first - 1),
    pageText(doc, last + 1)
  ])
  return {
    bookTitle,
    heading: headingForPage(doc.outline, first),
    selection: selection.text.replace(/\s+/g, ' ').trim(),
    pages,
    pageText: texts.join('\n\n'),
    prevTail: prev.slice(-NEIGHBOR_CHARS),
    nextHead: next.slice(0, NEIGHBOR_CHARS)
  }
}
