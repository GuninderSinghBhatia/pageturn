import type { PageAnnotations } from '../../stores/annotationStore'
import { drawPageAnnotations } from '../annotations/draw'

type Bake = (bmp: ImageBitmap, ann: PageAnnotations) => ImageBitmap

const isEmpty = (a: PageAnnotations): boolean =>
  a.highlights.length === 0 && a.ink.length === 0 && a.freeNotes.length === 0

/** Page bitmap with its annotations painted in, for the curl textures. */
export function bakePage(bmp: ImageBitmap, ann: PageAnnotations): ImageBitmap {
  const w = bmp.width
  const h = bmp.height
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  drawPageAnnotations(ctx, ann, w, h)
  const unit = w / 440 // overlay controls are sized in CSS px for a ~440px-wide page
  for (const n of ann.freeNotes) {
    const s = 24 * unit
    ctx.fillStyle = '#ffe680'
    ctx.strokeStyle = '#d9b84a'
    ctx.fillRect(n.anchor.point!.x * w - s / 2, n.anchor.point!.y * h - s / 2, s, s)
    ctx.strokeRect(n.anchor.point!.x * w - s / 2, n.anchor.point!.y * h - s / 2, s, s)
  }
  return canvas.transferToImageBitmap()
}

type Entry = { bmp: ImageBitmap; revision: number; baked: ImageBitmap }

/**
 * Baked page bitmaps keyed by page; re-baked when the page's bitmap or annotation revision
 * changes. Owns (and closes) the baked bitmaps, never the raw ones from the page cache.
 */
export class BakeCache {
  private entries = new Map<number, Entry>()

  constructor(private bake: Bake = bakePage) {}

  get(page: number, bmp: ImageBitmap, revision: number, ann: PageAnnotations): ImageBitmap {
    if (isEmpty(ann)) {
      this.drop(page)
      return bmp
    }
    const hit = this.entries.get(page)
    if (hit && hit.bmp === bmp && hit.revision === revision) return hit.baked
    this.drop(page)
    const baked = this.bake(bmp, ann)
    this.entries.set(page, { bmp, revision, baked })
    return baked
  }

  /** Pages that currently have a baked bitmap. */
  bakedPages(): number[] {
    return [...this.entries.keys()].sort((a, b) => a - b)
  }

  retain(pages: Set<number>): void {
    for (const p of [...this.entries.keys()]) if (!pages.has(p)) this.drop(p)
  }

  clear(): void {
    for (const p of [...this.entries.keys()]) this.drop(p)
  }

  private drop(page: number): void {
    this.entries.get(page)?.baked.close()
    this.entries.delete(page)
  }
}
