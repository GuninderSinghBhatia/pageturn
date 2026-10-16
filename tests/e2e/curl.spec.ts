import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { waitForWindowFit } from './annotationHelpers'
import { launchApp } from './helpers'

const TEXT500 = join(__dirname, '..', 'fixtures', 'text-500.pdf')

async function openBook(page: Page): Promise<void> {
  await page.evaluate((p) => window.api.library.import([p]), TEXT500)
  await page.getByTestId('book-card').getByRole('button').first().click()
  await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
  await waitForWindowFit(page)
}

test('rapid key presses never desync the page (Review Focus 5)', async () => {
  const { app, page } = await launchApp()
  try {
    await openBook(page)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-stage', 'curl')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-settled', 'true')
    await expect(page.getByTestId('page-box')).toHaveValue('11')
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '10,11')
  } finally {
    await app.close()
  }
})

test('mid-drag page flip matches the approved look', async () => {
  const { app, page } = await launchApp()
  try {
    await openBook(page)
    await page.keyboard.press('ArrowRight') // to spread 2–3 so both pages are visible
    const stage = page.getByTestId('book-stage')
    await expect(stage).toHaveAttribute('data-settled', 'true')
    const [x, y, w, h] = (await stage.getAttribute('data-right-rect'))!.split(',').map(Number)
    const box = (await stage.boundingBox())!
    const cornerX = box.x + x + w - 3
    const cornerY = box.y + y + h - 3
    await page.mouse.move(cornerX, cornerY)
    await page.mouse.down()
    const target = { x: box.x + x + w * 0.35, y: box.y + y + h * 0.6 }
    await page.mouse.move(target.x, target.y, { steps: 12 })
    await page.waitForTimeout(150)
    await expect(stage).toHaveScreenshot('flip-mid.png', { maxDiffPixelRatio: 0.02 })
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-settled', 'true')
  } finally {
    await app.close()
  }
})

test('falls back to the slide stage when WebGL is unavailable', async () => {
  const { app, page } = await launchApp(undefined, { PAGETURN_DISABLE_WEBGL: '1' })
  try {
    await openBook(page)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-stage', 'slide')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('page-box')).toHaveValue('3')
  } finally {
    await app.close()
  }
})
