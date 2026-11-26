import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const BASE_CSP = "default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:"

// index.html carries the base CSP. Tauri's webview also needs to reach its IPC
// endpoint (ipc: / http://ipc.localhost); in dev, Vite's HMR needs inline scripts and a socket.
function tauriCsp(dev: boolean): Plugin {
  return {
    name: 'pageturn-tauri-csp',
    transformIndexHtml: (html) =>
      html.replace(
        BASE_CSP,
        dev
          ? `${BASE_CSP}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost ws://localhost:5174`
          : `${BASE_CSP}; connect-src 'self' ipc: http://ipc.localhost`
      )
  }
}

// Renderer build for the Tauri app, served from
// its own port in dev and written to out/renderer-tauri for `tauri build`.
export default defineConfig(({ command }) => ({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
  plugins: [react(), tauriCsp(command === 'serve')],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve('out/renderer-tauri'),
    emptyOutDir: true,
    assetsInlineLimit: (file) => (/.woff2?$/.test(file) ? false : undefined)
  }
}))
