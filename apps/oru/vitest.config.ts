import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // The seam suite spawns a real host process per case, the way the
    // browser suite starts it. Host startup under a loaded runner exceeds
    // the 5s default, so this matches the host package timeouts.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})
