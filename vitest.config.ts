import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Renderer component tests opt into jsdom with a `// @vitest-environment jsdom` header.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true
  }
})
