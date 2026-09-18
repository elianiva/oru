import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every turn spawns a one-shot `claude -p` child, so each turn pays full
    // process startup, and the gated e2e spends a real model turn on top of
    // that. The catalogue and translation suites stay fast; the timeout is for
    // the child and the model, not the assertions.
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
})
