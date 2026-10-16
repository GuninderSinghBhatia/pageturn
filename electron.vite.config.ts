import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import { defineConfig as defineElectronConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

// Vite's dev server injects inline scripts/styles (HMR, React Refresh). Relax the CSP in
// dev only; production builds ship the exact CSP from index.html.
function devCsp(): Plugin {
  return {
    name: 'pageturn-dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(
        "default-src 'self';",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
      )
  }
}

export default defineElectronConfig({
  main: { resolve: { alias: shared } },
  // Sandboxed preloads can only require 'electron', so bundle everything else (e.g. zod).
  preload: { resolve: { alias: shared }, build: { externalizeDeps: false } },
  renderer: defineConfig({
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer') } },
    plugins: [react(), devCsp()],
    // Fonts stay files: the CSP (default-src 'self') blocks data: fonts.
    build: { assetsInlineLimit: (file) => (/.woff2?$/.test(file) ? false : undefined) }
  })
})
