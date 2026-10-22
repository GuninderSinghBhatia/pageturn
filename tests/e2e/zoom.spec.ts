import { test, expect, type Page } from '@playwright/test'
import { openAtSpread2 } from './annotationHelpers'
import { launchApp } from './helpers'

/** Where the first word of page 3 sits, as a fraction of the page's width and height. */
const wordOnPage = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const ov = document.querySelector('[data-page-overlay="3"]')!.getBoundingClientRect()
    const span = document
      .querySelector('[data-page-overlay="3"] .textLayer span')!
      .getBoundingClientRect()
    return { x: (span.left - ov.left) / ov.width, y: (span.top - ov.top) / ov.height }
  })

test('while zooming, text (and so highlights and selection) stays on its words', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    await page.mouse.move(900, 300)
    const fit = await wordOnPage(page)
    for (const key of ['Control+=', 'Control+=', 'Control+-']) {
      await page.keyboard.press(key)
      // Sample during the transition, before the text layer is laid out again (180 ms).
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(30)
        const now = await wordOnPage(page)
        expect(Math.abs(now.x - fit.x), `${key} +${i * 30}ms x`).toBeLessThan(0.004)
        expect(Math.abs(now.y - fit.y), `${key} +${i * 30}ms y`).toBeLessThan(0.004)
      }
    }
  } finally {
    await app.close()
  }
})

test('the bookmark tabs step aside while the book is zoomed in', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const gear = page.getByRole('button', { name: 'Settings tab' })
    await expect(gear).toBeVisible()
    await page.keyboard.press('Control+=')
    await expect(gear).toBeHidden()
    await page.keyboard.press('Control+0')
    await expect(gear).toBeVisible()
  } finally {
    await app.close()
  }
})
