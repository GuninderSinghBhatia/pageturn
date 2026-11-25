import { defineConfig } from '@playwright/test'

// Start-up and memory comparison (tests/measure). Not part of the regular suites.
export default defineConfig({
  testDir: 'tests/measure',
  timeout: 600_000,
  workers: 1,
  reporter: 'list'
})
