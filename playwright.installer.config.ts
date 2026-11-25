import { defineConfig } from '@playwright/test'

// Installer and signed-update tests (tests/installer). Build the test installers first:
//   npm run tauri:test:installers:build
export default defineConfig({
  testDir: 'tests/installer',
  timeout: 300_000,
  workers: 1,
  reporter: 'list'
})
