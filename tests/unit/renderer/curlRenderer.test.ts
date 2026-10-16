// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { CurlRenderer } from '@renderer/reader/BookStage/webgl/renderer'

/**
 * Minimal WebGL2 stand-in with real context-loss semantics: once lost (via the
 * WEBGL_lose_context extension), the same canvas keeps returning the dead context and shader
 * creation fails, exactly as in Chromium.
 */
function fakeCanvas(): HTMLCanvasElement {
  let lost = false
  const ext = { loseContext: () => (lost = true), restoreContext: () => (lost = false) }
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'isContextLost') return () => lost
      if (prop === 'getExtension')
        return (name: string) => (name === 'WEBGL_lose_context' ? ext : null)
      if (prop === 'createShader' || prop === 'createProgram') return () => (lost ? null : {})
      if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => !lost
      if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return () => null
      if (prop.startsWith('create')) return () => ({})
      if (/^[A-Z_0-9]+$/.test(prop)) return 0 // GL enum constants
      return () => null
    }
  })
  const canvas = document.createElement('canvas')
  canvas.getContext = ((type: string) => (type === 'webgl2' ? gl : null)) as never
  return canvas
}

describe('CurlRenderer', () => {
  it('can be created again on the same canvas after dispose (React StrictMode remount)', () => {
    const canvas = fakeCanvas()
    new CurlRenderer(canvas).dispose()
    expect(() => new CurlRenderer(canvas)).not.toThrow()
  })
})
