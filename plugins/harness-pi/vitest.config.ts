import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every test spawns a real child process (a scripted pi), and the bridge's
    // shutdown escalates only after a grace period.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
