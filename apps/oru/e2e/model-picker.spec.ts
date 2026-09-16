import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import { ProjectClient, ThreadClient, clientsFor } from '@oru/rpc'

const hostLog = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'host.log')

/** Where the suite's own host announced itself, which the dev server proxies to. */
const hostUrl = (): string => {
  const listening = /listening on (http:\/\/\S+)/u.exec(readFileSync(hostLog, 'utf8'))
  if (listening?.[1] === undefined) throw new Error('the host log names no listening url')
  return listening[1]
}

/** A real project and thread on the running host, through the app's own client. */
const seedThread = (): Promise<string> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const projects = yield* ProjectClient
        const threads = yield* ThreadClient
        const project = yield* projects.create('e2e', process.cwd())
        const created = yield* threads.create(project.id)
        return created.threadId
      }).pipe(Effect.provide(clientsFor(hostUrl()))),
    ),
  )

test('the picker offers the host default harness and its catalogue', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-composer-action="model"]').click()

  await expect(page.locator('[data-model-panel]')).toBeVisible()
  await expect(page.locator('[data-harness-label]')).toHaveText('pi')

  await page.locator('[data-model-search]').fill('scripted-mini')
  await expect(page.locator('[data-model-row]')).toHaveCount(1)
  await expect(page.locator('[data-model-row="scripted/scripted-mini"]')).toBeVisible()
})

test('a chosen model configures the thread and is still selected after a reload', async ({
  page,
}) => {
  const threadId = await seedThread()
  await page.goto(`/thread/${threadId}`)

  await page.locator('[data-composer-action="model"]').click()
  await expect(page.locator('[data-model-panel]')).toBeVisible()
  await page.locator('[data-model-search]').fill('scripted-mini')
  await expect(page.locator('[data-model-row]')).toHaveCount(1)
  await page.locator('[data-model-row="scripted/scripted-mini"]').click()

  await expect(page.locator('[data-model-panel]')).toHaveCount(0)
  await expect(page.locator('[data-composer-action="model"]')).toContainText('Scripted Mini')

  await page.reload()

  await expect(page.locator('[data-conversation]')).toBeVisible()
  await expect(page.locator('[data-composer-action="model"]')).toContainText('Scripted Mini')
})
