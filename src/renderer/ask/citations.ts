export type AnswerPart = { text: string } | { text: string; page: number }

// The model writes "(page 36)" or "(p. 36)"; its space is sometimes a narrow no-break space
// (U+202F). Splitting on a capture group puts every citation at an odd index.
const CITATION = /(\(?\s*(?:[Pp]ages?|[Pp]\.)[\s  ]*\d+\s*\)?)/

/** Splits an answer into plain text and "page N" citations (each carries its page number). */
export function splitCitations(answer: string): AnswerPart[] {
  return answer
    .split(CITATION)
    .map((text, i): AnswerPart => {
      const page = i % 2 === 1 ? /\d+/.exec(text)?.[0] : undefined
      return page ? { text, page: Number(page) } : { text }
    })
    .filter((part) => part.text !== '')
}
