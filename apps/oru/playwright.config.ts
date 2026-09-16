import { defineConfig } from '@playwright/test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))

/**
 * The suite owns both ports, and takes them from the environment so it can run
 * beside a `pnpm dev` that already holds the defaults.
 */
const appPort = Number(process.env.ORU_E2E_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(appPort)}`,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    cwd: appDir,
    url: `http://127.0.0.1:${String(appPort)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
