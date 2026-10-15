import {
  nextSpreadStart,
  prevSpreadStart,
  spreadFor,
  spreadPages,
  type ResolvedLayout
} from '../layout'
import type { OpenedDoc } from './pdfService'

const MAX_CONCURRENT = 2

/** Current spread first, then spreads alternating forward/back out to `radius`, de-duplicated. */
export function pagesToPrefetch(
  page: number,
  numPages: number,
  layout: ResolvedLayout,
  radius = 2
): number[] {
  const out: number[] = []
  const add = (start: number | null): void => {
    if (start === null) return
    for (const p of spreadPages(spreadFor(start, numPages, layout))) {
      if (p >= 1 && p <= numPages && !out.includes(p)) out.push(p)
    }
  }
  add(page)
  let fwd: number | null = page
  let back: number | null = page
  for (let i = 0; i < radius; i++) {
    fwd = fwd === null ? null : nextSpreadStart(fwd, numPages, layout)
    back = back === null ? null : prevSpreadStart(back, numPages, layout)
    add(fwd)
    add(back)
  }
  return out
}

/** Keeps the pages around the current spread rendered (into the doc's page cache). */
export class Prefetcher {
  private queue: number[] = []
  private active = 0
  private done = new Set<string>() // `${page}@${scale}`
  private running = new Set<string>()

  constructor(
    private doc: OpenedDoc,
    private scaleFor: (page: number) => number
  ) {}

  private key(page: number): string {
    return `${page}@${this.scaleFor(page)}`
  }

  /** Replaces the queue (stale jobs are dropped; in-flight renders finish). */
  update(page: number, layout: ResolvedLayout): void {
    this.queue = pagesToPrefetch(page, this.doc.numPages, layout).filter((p) => {
      const k = this.key(p)
      return !this.done.has(k) && !this.running.has(k)
    })
    this.pump()
  }

  ready(page: number): boolean {
    return this.done.has(this.key(page))
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const page = this.queue.shift()!
      const scale = this.scaleFor(page)
      const k = `${page}@${scale}`
      if (this.done.has(k) || this.running.has(k)) continue
      this.active++
      this.running.add(k)
      this.doc
        .renderPage(page, scale)
        .then(() => this.done.add(k))
        .catch((err) => console.warn(`Prefetch failed for page ${page}`, err))
        .finally(() => {
          this.active--
          this.running.delete(k)
          this.pump()
        })
    }
  }
}
