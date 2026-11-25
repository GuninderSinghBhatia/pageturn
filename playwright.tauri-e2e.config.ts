import { defineConfig } from '@playwright/test'

// The Electron end-to-end specs (tests/e2e), run against the Tauri app instead.
// Specs that use Electron-only APIs (app.evaluate, windows) are expected to fail.
process.env.PAGETURN_TAURI = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  // Tauri's window is a few pixels different from Electron's: it keeps its own reference images.
  snapshotPathTemplate:
    '{testDir}/{testFileDir}/{testFileName}-snapshots-tauri/{arg}-{platform}{ext}',
  // Electron-only: Electron's exact CSP and command-line hand-over (covered in tests/tauri instead).
  testIgnore: ['**/launch.spec.ts', '**/singleInstance.spec.ts'],
  reporter: 'list',
  webServer: {
    command: 'npx vite --config vite.tauri.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
