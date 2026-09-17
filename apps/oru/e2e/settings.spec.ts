import { expect, test } from '@playwright/test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

test('the sidebar settings icon opens settings at /settings', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav="settings"]').click()
  await expect(page).toHaveURL('/settings')
  await expect(page.locator('[data-settings]')).toBeVisible()
  await expect(page.locator('[data-settings-page="general"]')).toBeVisible()
  await expect(page.locator('[data-settings-link="general"]')).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('each settings section renders behind its own route', async ({ page }) => {
  await page.goto('/settings/providers')
  await expect(page.locator('[data-settings-page="providers"]')).toBeVisible()
  await expect(page.locator('[data-settings-link="providers"]')).toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.locator('[data-settings-link="appearance"]').click()
  await expect(page).toHaveURL('/settings/appearance')
  await expect(page.locator('[data-settings-page="appearance"]')).toBeVisible()
})

test('toggling a General switch flips its state', async ({ page }) => {
  await page.goto('/settings/general')
  const toggle = page.locator('#settings-navigate-to-threads')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})

test('back to app returns to the thread view', async ({ page }) => {
  await page.goto('/settings/keyboard')
  await page.locator('[data-settings-back]').click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('[data-thread-list]')).toBeVisible()
})

test('an unknown path explains itself with a way back', async ({ page }) => {
  await page.goto('/nope')
  await expect(page.locator('[data-settings]')).toHaveCount(0)
  await expect(page.locator('text=Nothing here')).toBeVisible()
})

test('the Projects page renames a project the host recorded', async ({ page }) => {
  const cwd = dirname(fileURLToPath(import.meta.url))
  await page.goto('/')
  await page.locator('[data-project-picker-trigger]').click()
  await page.locator('[data-project-picker-option="new-project"]').click()
  await page.locator('[data-project-picker-field="name"]').fill('rename-me')
  await page.locator('[data-project-picker-field="cwd"]').fill(cwd)
  await page.locator('[data-project-picker-submit]').click()
  await expect(page.locator('[data-project-picker-trigger]')).toContainText('rename-me')

  await page.goto('/settings/projects')
  const row = page.locator('[data-projects-row]', { hasText: 'rename-me' })
  await expect(row).toContainText(cwd)
  await row.locator('[data-projects-edit]').click()
  await page.locator('#settings-project-name').fill('renamed')
  await page.locator('[data-projects-save]').click()

  await expect(page.locator('[data-projects-row]', { hasText: 'renamed' })).toContainText(cwd)
  await page.reload()
  await expect(page.locator('[data-projects-row]', { hasText: 'renamed' })).toContainText(cwd)
})
