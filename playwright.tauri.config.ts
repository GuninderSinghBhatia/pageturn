import { defineConfig } from '@playwright/test'

// Tests for the Tauri build. They attach to the real app over CDP (tests/tauri/helpers.ts).
// One worker: Tauri's single-instance lock allows one PageTurn at a time.
export default defineConfig({
  testDir: 'tests/tauri',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npx vite --config vite.tauri.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
