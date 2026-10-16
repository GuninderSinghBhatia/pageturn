import type { PaperTint } from '@shared/types'
import { progressFromPointer, type Corner, type Vec2 } from './curlMath'
import { BEND, flipShadows } from './flipMath'
import { FRAGMENT_SHADER, MODE, VERTEX_SHADER } from './shaders'
import { TextureStore } from './textures'

export class WebGLUnavailableError extends Error {
  constructor(message = 'WebGL2 is unavailable') {
    super(message)
    this.name = 'WebGLUnavailableError'
  }
}

export type Rect = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>
export type PageTextures = {
  leftUnder?: ImageBitmap
  rightUnder?: ImageBitmap
  front?: ImageBitmap
  back?: ImageBitmap
  staticLeft?: ImageBitmap
  staticRight?: ImageBitmap
}

const EYE_DISTANCE = 6 // page widths: perspective of the lifted leaf
const MESH_COLS = 40
const MESH_ROWS = 60
const SHADOW_PAD = 40 // book drop shadow ≈ 0 20px 40px rgba(0,0,0,0.25)
const SHADOW_DROP = 20
const TINTS: Record<PaperTint, [number, number, number]> = {
  white: [1, 1, 1],
  cream: [0.98, 0.973, 0.957], // #FAF8F4
  sepia: [0.957, 0.925, 0.847], // #F4ECD8
  dark: [1, 1, 1]
}

/** WebGL2 book stage: flat page quads plus a cylinder-curled page mesh. */
export class CurlRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private u: Record<string, WebGLUniformLocation | null> = {}
  private quad: { vao: WebGLVertexArrayObject; count: number }
  private mesh: { vao: WebGLVertexArrayObject; count: number }
  private textures: TextureStore
  private pages: PageTextures = {}
  private rects: { left: Rect | null; right: Rect | null } = { left: null, right: null }
  private tint: PaperTint = 'cream'
  private progress = 0
  private size = { width: 1, height: 1 }
  private lostCb: (() => void) | null = null

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false })
    if (!gl) throw new WebGLUnavailableError()
    this.gl = gl
    this.program = this.link()
    for (const name of [
      'u_res',
      'u_rect',
      'u_aspect',
      'u_mode',
      'u_progress',
      'u_bend',
      'u_side',
      'u_eye',
      'u_front',
      'u_back',
      'u_dark',
      'u_tint',
      'u_shadow',
      'u_shadowSpine',
      'u_gutter',
      'u_stripes',
      'u_inner'
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name)
    }
    this.quad = this.grid(1, 1)
    this.mesh = this.grid(MESH_COLS, MESH_ROWS)
    this.textures = new TextureStore(gl)
    canvas.addEventListener('webglcontextlost', this.handleLost)
  }

  private handleLost = (e: Event): void => {
    e.preventDefault()
    this.lostCb?.()
  }

  private link(): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new WebGLUnavailableError(`Shader compile failed: ${gl.getShaderInfoLog(s)}`)
      }
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.bindAttribLocation(p, 0, 'a_uv')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new WebGLUnavailableError(`Program link failed: ${gl.getProgramInfoLog(p)}`)
    }
    return p
  }

  /** Subdivided unit quad (uv 0..1) as an indexed triangle mesh. */
  private grid(cols: number, rows: number): { vao: WebGLVertexArrayObject; count: number } {
    const gl = this.gl
    const verts = new Float32Array((cols + 1) * (rows + 1) * 2)
    let i = 0
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        verts[i++] = c / cols
        verts[i++] = r / rows
      }
    }
    const idx = new Uint16Array(cols * rows * 6)
    i = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c
        const b = a + cols + 1
        idx.set([a, b, a + 1, a + 1, b, b + 1], i)
        i += 6
      }
    }
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    return { vao, count: idx.length }
  }

  setViewport(width: number, height: number, dpr = window.devicePixelRatio): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.canvas.width = Math.round(this.size.width * dpr)
    this.canvas.height = Math.round(this.size.height * dpr)
  }

  setPages(textures: PageTextures): void {
    this.pages = textures
  }

  /** Uploads bitmaps likely needed soon (call while idle) and frees all others. */
  preload(bitmaps: ImageBitmap[]): void {
    this.textures.retainOnly(bitmaps)
  }

  setLayout(rects: { left: Rect | null; right: Rect | null }): void {
    this.rects = rects
  }

  setTint(t: PaperTint): void {
    this.tint = t
  }

  /** Reading progress 0..1, shown as page-stack thickness on the book edges. */
  setProgress(p: number): void {
    this.progress = Math.min(1, Math.max(0, p))
  }

  onContextLost(cb: () => void): void {
    this.lostCb = cb
  }

  draw(state: { corner: Corner; pointer: Vec2 } | null): void {
    const gl = this.gl
    if (gl.isContextLost()) return
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(this.u.u_res, this.size.width, this.size.height)
    gl.uniform3fv(this.u.u_tint, TINTS[this.tint])
    gl.uniform1i(this.u.u_dark, this.tint === 'dark' ? 1 : 0)
    gl.uniform1i(this.u.u_front, 0)
    gl.uniform1i(this.u.u_back, 1)

    const { left, right } = this.rects
    const p = this.pages
    const dir = state ? (state.corner[1] === 'r' ? 1 : -1) : 0
    const single = left !== null && left === right
    const leftTex = dir === -1 ? p.leftUnder : single ? undefined : p.staticLeft
    const rightTex = dir === 1 ? p.rightUnder : single && dir === -1 ? undefined : p.staticRight

    // Shadows and page-stack edges behind the book.
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    for (const r of new Set([left, right])) if (r) this.drawShadow(r)
    gl.disable(gl.BLEND)
    if (left && !single) this.drawEdge(left, 'left', this.progress)
    if (right) this.drawEdge(right, 'right', 1 - this.progress)

    // The leaf turns by how far the pointer has travelled towards the far side.
    const progress = state ? progressFromPointer(state.corner, state.pointer) : 0
    const sh = flipShadows(progress)
    // Page being uncovered (under the leaf) and page it lands on, with their spine side.
    const shadeLeft = dir === -1 ? sh.under : dir === 1 && !single ? sh.landing : 0
    const shadeRight = dir === 1 ? sh.under : dir === -1 && !single ? sh.landing : 0
    if (left && leftTex) this.drawFlat(left, leftTex, single ? 0 : 1, shadeLeft, single ? 0 : 1)
    if (right && rightTex) this.drawFlat(right, rightTex, single ? 0 : -1, shadeRight, 0)
    const turning = dir === 1 ? right : left
    if (state && turning) this.drawFlip(turning, progress, single ? 1 : dir)
  }

  private setRect(r: Rect): void {
    this.gl.uniform4f(this.u.u_rect, r.x, r.y, r.width, r.height)
    this.gl.uniform1f(this.u.u_aspect, r.height / r.width)
  }

  private bindTex(unit: number, bmp: ImageBitmap | undefined): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(bmp))
  }

  private drawQuad(mode: number): void {
    const gl = this.gl
    gl.uniform1i(this.u.u_mode, mode)
    gl.bindVertexArray(this.quad.vao)
    gl.drawElements(gl.TRIANGLES, this.quad.count, gl.UNSIGNED_SHORT, 0)
  }

  private drawShadow(r: Rect): void {
    this.setRect({
      x: r.x - SHADOW_PAD,
      y: r.y - SHADOW_PAD + SHADOW_DROP,
      width: r.width + 2 * SHADOW_PAD,
      height: r.height + 2 * SHADOW_PAD
    })
    this.gl.uniform4f(this.u.u_inner, r.x, r.y + SHADOW_DROP, r.width, r.height)
    this.drawQuad(MODE.shadow)
  }

  private drawEdge(r: Rect, side: 'left' | 'right', amount: number): void {
    const w = 1 + 6 * amount
    const x = side === 'left' ? r.x - w : r.x + r.width
    this.setRect({ x, y: r.y + 1, width: w, height: r.height - 2 })
    this.gl.uniform1f(this.u.u_stripes, Math.max(1, Math.round(w / 1.5)))
    this.drawQuad(MODE.edge)
  }

  private drawFlat(
    r: Rect,
    bmp: ImageBitmap,
    gutter: number,
    shadow: number,
    shadowSpine: 0 | 1
  ): void {
    const gl = this.gl
    this.setRect(r)
    this.bindTex(0, bmp)
    gl.uniform1f(this.u.u_gutter, gutter)
    gl.uniform1f(this.u.u_shadow, shadow)
    gl.uniform1f(this.u.u_shadowSpine, shadowSpine)
    this.drawQuad(MODE.flat)
  }

  /** The leaf swinging around the spine; side +1 = it starts right of the spine. */
  private drawFlip(r: Rect, progress: number, side: number): void {
    const gl = this.gl
    this.setRect(r)
    this.bindTex(0, this.pages.front)
    this.bindTex(1, this.pages.back)
    gl.uniform1f(this.u.u_progress, progress)
    gl.uniform1f(this.u.u_bend, BEND)
    gl.uniform1f(this.u.u_side, side)
    gl.uniform1f(this.u.u_eye, EYE_DISTANCE)
    gl.uniform1i(this.u.u_mode, MODE.flip)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.bindVertexArray(this.mesh.vao)
    gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_SHORT, 0)
    gl.disable(gl.DEPTH_TEST)
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.textures.dispose()
    this.gl.deleteProgram(this.program)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
