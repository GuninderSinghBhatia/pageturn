import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { openReaderSettings } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

const TEXT500 = join(__dirname, '..', 'fixtures', 'text-500.pdf')

test('settings apply live to the open book and persist across restarts', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await page.getByTestId('book-card').getByRole('button').first().click()
    const stage = page.getByTestId('book-stage')
    await expect(stage).toHaveAttribute('data-stage', 'curl')

    await openReaderSettings(page)
    await page.getByRole('radio', { name: 'Slide' }).check()
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // Arrow keys move between radios when one is focused; with focus elsewhere the reader
    // behind the overlay must still ignore them.
    await page.getByRole('heading', { name: 'Settings' }).click()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByTestId('settings')).toHaveCount(0)

    await expect(stage).toHaveAttribute('data-stage', 'slide')
    await expect(page.getByTestId('page-box')).toHaveValue('1')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('page-box')).toHaveValue('3')
  } finally {
    await app.close()
  }

  ;({ app, page } = await launchApp(userData))
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('radio', { name: 'Slide' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
