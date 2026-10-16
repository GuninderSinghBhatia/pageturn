/** GPU textures for page bitmaps, uploaded once per ImageBitmap; a white placeholder fills gaps. */
export class TextureStore {
  private textures = new Map<ImageBitmap, WebGLTexture>()
  private placeholderTex: WebGLTexture

  constructor(private gl: WebGL2RenderingContext) {
    this.placeholderTex = this.create()
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255])
    )
  }

  private create(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  get placeholder(): WebGLTexture {
    return this.placeholderTex
  }

  /** Texture for a bitmap (uploading it on first use); the placeholder if missing or closed. */
  get(bmp: ImageBitmap | undefined): WebGLTexture {
    if (!bmp) return this.placeholderTex
    const existing = this.textures.get(bmp)
    if (existing) return existing
    if (bmp.width === 0) return this.placeholderTex // closed by the page cache before upload
    const tex = this.create()
    try {
      const gl = this.gl
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
    } catch {
      this.gl.deleteTexture(tex)
      return this.placeholderTex
    }
    this.textures.set(bmp, tex)
    return tex
  }

  /** Uploads these bitmaps now and frees textures for any bitmap not in the list. */
  retainOnly(bitmaps: ImageBitmap[]): void {
    const keep = new Set(bitmaps)
    for (const [bmp, tex] of this.textures) {
      if (!keep.has(bmp)) {
        this.gl.deleteTexture(tex)
        this.textures.delete(bmp)
      }
    }
    for (const bmp of bitmaps) this.get(bmp)
  }

  dispose(): void {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex)
    this.textures.clear()
    this.gl.deleteTexture(this.placeholderTex)
  }
}
