import { expect, test, type Page, type TestInfo } from '@playwright/test'
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

const columns = (page: Page) =>
  page
    .locator('[data-slot="resizable-panel"]')
    .evaluateAll((panels) => panels.map((panel) => Math.round(panel.getBoundingClientRect().width)))

/**
 * The widths once the layout has stopped moving. A toggle animates `flex-grow`
 * for 200ms, so a width read on the click's own frame is a mid-animation one.
 */
const settledColumns = async (page: Page): Promise<readonly number[]> => {
  let previous: readonly number[] = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(50)
    const current = await columns(page)
    if (String(current) === String(previous)) return current
    previous = current
  }
  return previous
}

const rpcCall = /\/rpc\/(?:host|thread|project)\/?(?:\?.*)?$/u

const separators = (page: Page) => page.locator('[data-slot="resizable-handle"]')

const dragBy = async (page: Page, handleIndex: number, deltaX: number) => {
  const box = await separators(page).nth(handleIndex).boundingBox()
  if (box === null) throw new Error(`separator ${String(handleIndex)} has no box`)
  const startX = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(startX + deltaX * step, y)
  }
  await page.mouse.up()
}

test('the shell renders three columns and a separator between each pair', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-shell-toggle="left"]')).toBeVisible()
  await expect(page.locator('[data-shell-toggle="right"]')).toBeVisible()
  await expect(page.locator('[data-thread-list]')).toBeVisible()
  await expect(page.locator('[data-main]')).toBeVisible()
  await expect(page.locator('[data-detail]')).toBeVisible()
  await expect(page.locator('[data-slot="resizable-panel"]')).toHaveCount(3)
  await expect(separators(page)).toHaveCount(2)
})

test('dragging the left separator moves the seam and leaves the right column alone', async ({
  page,
}) => {
  await page.goto('/')
  const [left, main, right] = await columns(page)
  if (left === undefined || main === undefined || right === undefined) {
    throw new Error('expected three columns')
  }

  await dragBy(page, 0, 120)

  const [leftAfter, mainAfter, rightAfter] = await columns(page)
  expect(leftAfter).toBe(left + 120)
  expect(mainAfter).toBe(main - 120)
  expect(rightAfter).toBe(right)
})

test('both sidebars collapse and both toggles stay reachable', async ({ page }) => {
  await page.goto('/')
  const [left, , right] = await settledColumns(page)

  await page.locator('[data-shell-toggle="left"]').click()
  await expect(page.locator('[data-shell-toggle="left"]')).toHaveAttribute('aria-expanded', 'false')
  expect((await settledColumns(page))[0]).toBe(0)

  await page.locator('[data-shell-toggle="right"]').click()
  await expect(page.locator('[data-shell-toggle="right"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )

  const collapsed = await settledColumns(page)
  expect(collapsed[2]).toBe(0)
  expect(collapsed[1]).toBeGreaterThan(0)
  for (const side of ['left', 'right'] as const) {
    await expect(page.locator(`[data-shell-toggle="${side}"]`)).toBeInViewport()
  }

  // Both handles are back once both sidebars are open again, so the widths the
  // shell started with are the widths to compare against.
  await page.locator('[data-shell-toggle="left"]').click()
  await page.locator('[data-shell-toggle="right"]').click()
  await expect(page.locator('[data-shell-toggle="left"]')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-shell-toggle="right"]')).toHaveAttribute('aria-expanded', 'true')

  const reopened = await settledColumns(page)
  expect(reopened[0]).toBe(left)
  expect(reopened[2]).toBe(right)
})

test('a collapsed sidebar and a dragged width both survive a reload', async ({ page }) => {
  await page.goto('/')
  const before = (await settledColumns(page))[0]
  await dragBy(page, 0, 90)
  const dragged = (await settledColumns(page))[0]
  expect(dragged).toBeGreaterThan(before)

  await page.locator('[data-shell-toggle="right"]').click()
  const collapsed = (await settledColumns(page))[0]

  await page.reload()

  const reloaded = await settledColumns(page)
  expect(reloaded[0]).toBe(collapsed)
  expect(reloaded[2]).toBe(0)
  await expect(page.locator('[data-shell-toggle="right"]')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('the separator collapses its sidebar from the keyboard', async ({ page }) => {
  await page.goto('/')
  await separators(page).nth(0).focus()
  await page.keyboard.press('Enter')
  expect((await settledColumns(page))[0]).toBe(0)
  await expect(page.locator('[data-shell-toggle="left"]')).toHaveAttribute('aria-expanded', 'false')
})

test('picking a thread selects it in the URL and fills the right column', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-detail]')).toContainText('No thread selected')

  await page.locator('[data-thread-row="shell-retro"]').click()

  await expect(page).toHaveURL(/\/thread\/shell-retro$/u)
  await expect(page.locator('[data-thread-row="shell-retro"]')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('[data-detail]')).toContainText(
    'Fold the resizable engine into the app shell',
  )
  await expect(page.locator('[data-detail]')).toContainText('feat/panel-shell')
})

test('a thread URL is the conversation, and a reload keeps you in it', async ({ page }) => {
  await page.goto('/thread/shell-retro')

  await expect(page.locator('[data-conversation]')).toContainText(
    'Fold the resizable engine into the app shell',
  )
  await expect(page.locator('[data-main]')).toHaveCount(0)
  await expect(page.locator('[data-thread-row="shell-retro"]')).toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.reload()

  await expect(page).toHaveURL(/\/thread\/shell-retro$/u)
  await expect(page.locator('[data-conversation]')).toBeVisible()
  await expect(page.locator('[data-thread-row="shell-retro"]')).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('the back button leaves the conversation for the hero composer', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-thread-row="shell-retro"]').click()
  await expect(page.locator('[data-conversation]')).toBeVisible()

  await page.goBack()

  await expect(page).toHaveURL(/\/$/u)
  await expect(page.locator('[data-main]')).toBeVisible()
  await expect(page.locator('[data-composer-headline]')).toContainText(
    'What should we build in oru?',
  )
})

test('a fresh host renders the empty projects state, not an empty list', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-projects-empty]')).toBeVisible()
  await expect(page.locator('[data-projects-empty]')).toContainText('No projects yet')
  await expect(page.locator('[data-projects-list]')).toHaveCount(0)
})

test('a host that is down renders a named state, and the retry recovers', async ({ page }) => {
  await page.route(rpcCall, (route) => route.abort())
  await page.goto('/')

  await expect(page.locator('[data-host-unreachable]')).toBeVisible()
  await expect(page.locator('[data-host-unreachable]')).toContainText('Host unreachable')
  await expect(page.locator('[data-host-retry]')).toBeVisible()
  await expect(page.locator('[data-main]')).toHaveCount(0)

  await page.unroute(rpcCall)
  await page.locator('[data-host-retry]').click()

  await expect(page.locator('[data-host-unreachable]')).toHaveCount(0)
  await expect(page.locator('[data-main]')).toBeVisible()
  await expect(page.locator('[data-projects-empty]')).toBeVisible()
})

test('the composer still submits a draft and clears the box', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-composer-headline]')).toContainText(
    'What should we build in oru?',
  )
  await page.locator('[data-composer-input]').fill('hello composer')
  await page.locator('[data-composer-submit]').click()
  await expect(page.locator('[data-composer-input]')).toHaveValue('')
  await expect(page.locator('[data-composer-submit][data-disabled]')).toHaveCount(1)
})
