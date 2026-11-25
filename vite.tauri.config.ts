import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer build for the Tauri app: the same React code as the Electron build, served from
// its own port in dev and written to out/renderer-tauri for `tauri build`.
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve('out/renderer-tauri'),
    emptyOutDir: true,
    assetsInlineLimit: (file) => (/.woff2?$/.test(file) ? false : undefined)
  }
})
