import { test, expect } from '@playwright/test'
import { launchApp, makeUserDataDir } from './helpers'

test('first run: the Welcome book is in the library and a short tour shows once', async () => {
  test.setTimeout(60_000)
  const userData = makeUserDataDir()
  const first = await launchApp(userData, { PAGETURN_SKIP_ONBOARDING: '0' })
  try {
    const { page } = first
    await expect(page.getByTestId('book-title')).toHaveText(['Welcome to PageTurn'])
    const tour = page.getByRole('dialog', { name: 'Welcome tour' })
    await expect(tour).toBeVisible()
    for (let i = 0; i < 3; i++) await tour.getByRole('button', { name: 'Next' }).click()
    await expect(tour.getByText(/Ctrl\+E/)).toBeVisible()
    await tour.getByRole('button', { name: 'Done' }).click()
    await expect(tour).toHaveCount(0)
  } finally {
    await first.app.close()
  }

  const again = await launchApp(userData, { PAGETURN_SKIP_ONBOARDING: '0' })
  try {
    const { page } = again
    await expect(page.getByTestId('book-title')).toHaveText(['Welcome to PageTurn'])
    await page.waitForTimeout(500)
    await expect(page.getByRole('dialog', { name: 'Welcome tour' })).toHaveCount(0)
    // Settings → About can bring it back.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Show tour again' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome tour' })).toBeVisible()
  } finally {
    await again.app.close()
  }
})
