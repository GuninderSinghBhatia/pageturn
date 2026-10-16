import { test, expect } from '@playwright/test'
import {
  bodyLine,
  dragSelect,
  highlightPoint,
  openAtSpread2,
  showToolbar,
  stored,
  TEXT500
} from './annotationHelpers'
import { launchApp } from './helpers'

test('the book opens with no chrome; the toolbar appears at the top edge and hides again', async () => {
  const { app, page } = await launchApp()
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await page.getByTestId('book-card').getByRole('button').first().click()
    const stage = page.getByTestId('book-stage')
    await expect(stage).toHaveAttribute('data-settled', 'true')
    const toolbar = page.getByRole('toolbar', { name: 'Reader tools' })

    await expect(toolbar).toBeHidden()
    await expect(page.getByRole('button', { name: 'Back to library' })).toBeHidden()

    const size =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    await page.mouse.move(size.width / 2, size.height / 2)
    await page.mouse.move(size.width / 2, 10, { steps: 4 })
    await expect(toolbar).toBeVisible()
    for (const name of [
      'Back to library',
      'Highlighter',
      'Underline',
      'Pen',
      'Eraser',
      'Bookmark page',
      'Contents',
      'Search',
      'Display',
      'Fullscreen'
    ]) {
      await expect(toolbar.getByRole('button', { name })).toBeVisible()
    }
    await expect(toolbar.getByTestId('page-box')).toHaveValue('1')

    await page.mouse.move(size.width / 2, size.height / 2, { steps: 4 })
    await expect(toolbar).toBeHidden({ timeout: 2000 })

    await page.keyboard.press('t')
    await expect(toolbar).toBeVisible()
    await page.keyboard.press('t')
    await expect(toolbar).toBeHidden()

    // Display menu: layout and theme.
    await page.keyboard.press('t')
    await toolbar.getByRole('button', { name: 'Display' }).click()
    await page.getByRole('button', { name: 'Single page' }).click()
    await expect(stage).toHaveAttribute('data-pages', '1')
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // Ctrl+F opens the toolbar with search focused.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeHidden()
    await page.keyboard.press('Control+f')
    await expect(page.getByTestId('find-input')).toBeFocused()
  } finally {
    await app.close()
  }
})

test('highlighter and wavy underline tools annotate a selection as soon as it is made; eraser removes it', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    await showToolbar(page)
    await page.getByRole('button', { name: 'Highlighter' }).click()
    await page
      .getByRole('group', { name: 'Highlighter colour' })
      .getByRole('button', { name: 'blue' })
      .click()
    const line = await bodyLine(page, 2)
    await dragSelect(page, line, line)
    await expect
      .poll(async () => (await stored(page)).highlights.map((h) => [h.color, h.style]))
      .toEqual([['blue', 'highlight']])

    await page.getByRole('button', { name: 'Underline' }).click()
    await page.getByRole('button', { name: 'Wavy' }).click()
    const line3 = await bodyLine(page, 3)
    await dragSelect(page, line3, line3)
    await expect
      .poll(async () => (await stored(page)).highlights.map((h) => h.style).sort())
      .toEqual(['highlight', 'wavy'])

    await page.getByRole('button', { name: 'Eraser' }).click()
    const hl = (await stored(page)).highlights.find((h) => h.style === 'wavy')!
    const pt = await highlightPoint(page, hl)
    await page.mouse.move(pt.x - 20, pt.y)
    await page.mouse.down()
    await page.mouse.move(pt.x + 20, pt.y, { steps: 5 })
    await page.mouse.up()
    await expect
      .poll(async () => (await stored(page)).highlights.map((h) => h.style))
      .toEqual(['highlight'])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Eraser' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  } finally {
    await app.close()
  }
})
