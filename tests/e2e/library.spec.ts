import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, makeUserDataDir } from './helpers'

const TEXT500 = join(__dirname, '..', 'fixtures', 'text-500.pdf')

test('imported book appears with a cover and survives restart', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    const card = page.getByTestId('book-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('img')).toBeVisible({ timeout: 5000 })
    await expect(card.getByTestId('book-title')).toHaveText('Text 500')
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(userData))
  try {
    await expect(page.getByTestId('book-card')).toHaveCount(1)
    await expect(page.getByTestId('book-card').locator('img')).toBeVisible()
  } finally {
    await app.close()
  }
})
