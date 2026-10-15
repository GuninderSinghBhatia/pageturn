import { test, expect } from '@playwright/test'
import { launchApp, CSP } from './helpers'

test('opens a secure PageTurn window', async () => {
  const { app, page } = await launchApp()
  try {
    await expect(page).toHaveTitle('PageTurn')
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)
    ).toBe('undefined')
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')
    expect(csp).toBe(CSP)
  } finally {
    await app.close()
  }
})
