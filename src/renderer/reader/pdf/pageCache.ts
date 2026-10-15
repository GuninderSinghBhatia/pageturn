/** LRU cache of rendered page bitmaps keyed by (page, scale), bounded by pixel memory. */
export class PageCache {
  private entries = new Map<string, ImageBitmap>() // insertion order = recency (oldest first)
  private total = 0

  constructor(private maxBytes = 300 * 1024 * 1024) {}

  private static key(page: number, scale: number): string {
    return `${page}@${scale}`
  }

  private static size(bmp: ImageBitmap): number {
    return bmp.width * bmp.height * 4
  }

  get(page: number, scale: number): ImageBitmap | undefined {
    const key = PageCache.key(page, scale)
    const bmp = this.entries.get(key)
    if (bmp) {
      this.entries.delete(key)
      this.entries.set(key, bmp)
    }
    return bmp
  }

  set(page: number, scale: number, bmp: ImageBitmap): void {
    const key = PageCache.key(page, scale)
    const old = this.entries.get(key)
    if (old) {
      this.entries.delete(key)
      this.total -= PageCache.size(old)
      if (old !== bmp) old.close()
    }
    this.entries.set(key, bmp)
    this.total += PageCache.size(bmp)
    // Evict oldest entries, but never the one just inserted.
    for (const [k, v] of this.entries) {
      if (this.total <= this.maxBytes || k === key) break
      this.entries.delete(k)
      this.total -= PageCache.size(v)
      v.close()
    }
  }

  has(page: number, scale: number): boolean {
    return this.entries.has(PageCache.key(page, scale))
  }

  clear(): void {
    for (const bmp of this.entries.values()) bmp.close()
    this.entries.clear()
    this.total = 0
  }

  get bytes(): number {
    return this.total
  }
}
