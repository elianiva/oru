import { expect, test } from '@playwright/test'

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
