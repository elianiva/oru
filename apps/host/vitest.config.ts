import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The end-to-end test spawns a real host process, which spawns a real pi
    // child against a scripted provider.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})
