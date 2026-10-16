import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { bodyLine, dragSelect, FIXTURES, openAtSpread2, spans } from './annotationHelpers'
import { launchApp } from './helpers'

for (const style of ['curl', 'slide'] as const) {
  test(`text on a settled page is selectable without turning (${style})`, async () => {
    const { app, page } = await launchApp()
    try {
      await page.evaluate((s) => window.api.settings.set({ pageTurnStyle: s }), style)
      await page.reload() // the settings store loads at startup
      await openAtSpread2(page)
      await expect(page.getByTestId('book-stage')).toHaveAttribute('data-stage', style)
      const line = await bodyLine(page, 2)
      await dragSelect(page, line, line)
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Lorem')
      await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')
    } finally {
      await app.close()
    }
  })
}

test('a plain click on text in the outer third still turns the page', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const overlay = (await page.locator('[data-page-overlay="3"]').boundingBox())!
    const edge = overlay.x + overlay.width * 0.7
    const target = (await spans(page, 3)).find((s) => s.x + s.width > edge + 6)!
    await page.mouse.click(Math.max(target.x, edge) + 3, target.y + target.height / 2)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '4,5')
  } finally {
    await app.close()
  }
})

test('a scanned PDF opens with no text layer and no errors', async () => {
  const { app, page } = await launchApp()
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  try {
    await page.evaluate((p) => window.api.library.import([p]), join(FIXTURES, 'scanned.pdf'))
    await page.getByTestId('book-card').getByRole('button').first().click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-settled', 'true')
    await expect(page.locator('[data-page-overlay="1"]')).toBeAttached()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-page-overlay="1"] .textLayer span')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
