import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The embedded host boots a whole OpenCode (routes, database, watchers)
    // before any assertion runs, and the gated e2e spends a real model turn on
    // top of that. The translation and assembly suites stay fast; the timeout
    // is for the host and the model, not the assertions.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
