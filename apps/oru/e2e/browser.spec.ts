import { expect, test, type TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostLog = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'host.log')

const attachFailureEvidence = async (testInfo: TestInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  let body = 'host.log was not written'
  try {
    const log = readFileSync(hostLog, 'utf8')
    body = log.length <= 8_000 ? log : log.slice(-8_000)
  } catch (error) {
    body = error instanceof Error ? error.message : String(error)
  }
  process.stderr.write(`host.log tail\n${body}\n`)
  await testInfo.attach('host.log', { body, contentType: 'text/plain' })
}

test.afterEach(async ({}, testInfo) => {
  await attachFailureEvidence(testInfo)
})

test('logging toggle hides and restores Log and Greet', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-logging-toggle]')).toBeVisible()
  await expect(page.getByText('Log', { exact: true })).toBeVisible()
  await expect(page.getByText('Greet', { exact: true })).toBeVisible()
  await page.locator('[data-logging-toggle]').click()
  await expect(page.getByText('Turn logging on')).toBeVisible()
  await expect(page.getByText('Log', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Greet', { exact: true })).toHaveCount(0)
  await page.locator('[data-logging-toggle]').click()
  await expect(page.getByText('Turn logging off')).toBeVisible()
  await expect(page.getByText('Log', { exact: true })).toBeVisible()
  await expect(page.getByText('Greet', { exact: true })).toBeVisible()
})

test('send a message records the demo turn on the transcript', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-thread-panel]')).toBeVisible()
  await page.locator('[data-thread-draft]').fill('hello')
  await page.locator('[data-thread-send]').click()
  await expect(page.getByText('user: hello')).toBeVisible()
  await expect(page.getByText('assistant: done')).toBeVisible({ timeout: 20_000 })
})
