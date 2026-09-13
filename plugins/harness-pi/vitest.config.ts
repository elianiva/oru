import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every test spawns a real pi child against a scripted provider, and the
    // bridge's shutdown escalates only after a grace period. The e2e test
    // spends a real model turn, which is slower still.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})
