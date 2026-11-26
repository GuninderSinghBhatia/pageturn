import { defineConfig } from '@playwright/test'

// End-to-end specs. They attach to the real Tauri app over CDP (tests/tauri/helpers.ts), so run
// `npm run tauri:build:debug` first. One worker: Tauri's single-instance lock allows one PageTurn.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  // Reference images were taken in the Tauri window; the folder name is kept from the port.
  snapshotPathTemplate:
    '{testDir}/{testFileDir}/{testFileName}-snapshots-tauri/{arg}-{platform}{ext}',
  reporter: 'list',
  webServer: {
    command: 'npx vite --config vite.tauri.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
