import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PageCache } from './pageCache'

GlobalWorkerOptions.workerSrc = workerUrl

export type OutlineItem = { title: string; page: number | null; children: OutlineItem[] }
export type TextItem = { str: string; transform: number[] }

export interface OpenedDoc {
  numPages: number
  outline: OutlineItem[]
  metadata: { title: string | null; author: string | null }
  /** PDF points; exact once the page has been loaded, else page 1's size as an estimate. */
  pageSize(page: number): { width: number; height: number }
  renderPage(page: number, scale: number): Promise<ImageBitmap>
  getText(page: number): Promise<TextItem[]>
  hasText(page: number): Promise<boolean>
  destroy(): void
}

export class PasswordCancelledError extends Error {
  constructor() {
    super('Password entry cancelled')
    this.name = 'PasswordCancelledError'
  }
}

type OpenOptions = { onPassword: (retry: boolean) => Promise<string | null> }

export async function openPdf(data: ArrayBuffer, opts: OpenOptions): Promise<OpenedDoc> {
  // pdf.js transfers the buffer to its worker; copy so the caller's buffer stays usable.
  const task = getDocument({
    data: new Uint8Array(data.slice(0)),
    // Font data for non-embedded standard fonts (copied by scripts/copy-pdf-assets.mjs).
    standardFontDataUrl:
      typeof document === 'undefined'
        ? undefined
        : new URL('standard_fonts/', document.baseURI).href
  })
  let cancelled = false
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    opts.onPassword(reason === PasswordResponses.INCORRECT_PASSWORD).then((pw) => {
      if (pw === null) {
        cancelled = true
        void task.destroy()
      } else update(pw)
    })
  }
  let pdf: PDFDocumentProxy
  try {
    pdf = await task.promise
  } catch (err) {
    if (cancelled) throw new PasswordCancelledError()
    throw err
  }
  const [outline, metadata, first] = await Promise.all([
    loadOutline(pdf),
    loadMetadata(pdf),
    pdf.getPage(1)
  ])
  return new Doc(pdf, () => void task.destroy(), outline, metadata, first)
}

async function loadMetadata(pdf: PDFDocumentProxy): Promise<OpenedDoc['metadata']> {
  try {
    const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> }
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return { title: str(info?.Title), author: str(info?.Author) }
  } catch {
    return { title: null, author: null }
  }
}

async function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineItem[]> {
  type RawItem = { title: string; dest: string | unknown[] | null; items: RawItem[] }
  const resolvePage = async (dest: RawItem['dest']): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const ref = explicit[0]
      if (typeof ref === 'number') return ref + 1
      return (await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
    } catch {
      return null
    }
  }
  const convert = async (items: RawItem[]): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (it) => ({
        title: it.title,
        page: await resolvePage(it.dest),
        children: await convert(it.items ?? [])
      }))
    )
  try {
    return await convert(((await pdf.getOutline()) ?? []) as RawItem[])
  } catch {
    return []
  }
}

class Doc implements OpenedDoc {
  numPages: number
  private sizes = new Map<number, { width: number; height: number }>()
  private cache = new PageCache()
  private inflight = new Map<string, Promise<ImageBitmap>>()

  constructor(
    private pdf: PDFDocumentProxy,
    private destroyTask: () => void,
    public outline: OutlineItem[],
    public metadata: OpenedDoc['metadata'],
    first: PDFPageProxy
  ) {
    this.numPages = pdf.numPages
    this.remember(1, first)
  }

  private remember(n: number, page: PDFPageProxy): void {
    const vp = page.getViewport({ scale: 1 })
    this.sizes.set(n, { width: vp.width, height: vp.height })
  }

  private async page(n: number): Promise<PDFPageProxy> {
    const page = await this.pdf.getPage(n)
    if (!this.sizes.has(n)) this.remember(n, page)
    return page
  }

  pageSize(n: number): { width: number; height: number } {
    const known = this.sizes.get(n)
    if (known) return known
    void this.page(n).catch(() => undefined) // learn the real size for next time
    return this.sizes.get(1)!
  }

  renderPage(n: number, scale: number): Promise<ImageBitmap> {
    const cached = this.cache.get(n, scale)
    if (cached) return Promise.resolve(cached)
    const key = `${n}@${scale}`
    let job = this.inflight.get(key)
    if (!job) {
      job = this.draw(n, scale).finally(() => this.inflight.delete(key))
      this.inflight.set(key, job)
    }
    return job
  }

  private async draw(n: number, scale: number): Promise<ImageBitmap> {
    const page = await this.page(n)
    const viewport = page.getViewport({ scale })
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')!
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport
    }).promise
    const bmp = canvas.transferToImageBitmap()
    this.cache.set(n, scale, bmp)
    return bmp
  }

  async getText(n: number): Promise<TextItem[]> {
    const content = await (await this.page(n)).getTextContent()
    return content.items
      .filter((it): it is typeof it & TextItem => 'str' in it)
      .map((it) => ({ str: it.str, transform: it.transform as number[] }))
  }

  async hasText(n: number): Promise<boolean> {
    return (await this.getText(n)).some((t) => t.str.trim().length > 0)
  }

  destroy(): void {
    this.cache.clear()
    this.destroyTask()
  }
}
