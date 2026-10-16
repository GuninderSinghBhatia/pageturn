import { test, expect, type Page } from '@playwright/test'
import {
  goToPage,
  hideToolbar,
  openAtSpread2,
  openReaderSettings,
  stored
} from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

/** Mouse stroke across the blank lower part of a page (fractions of the page box). */
export async function stroke(
  page: Page,
  p: number,
  from: [number, number],
  to: [number, number]
): Promise<void> {
  const b = (await page.locator(`[data-page-overlay="${p}"]`).boundingBox())!
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1])
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 10 })
  await page.mouse.up()
}

/** Alpha of the page's annotation canvas at a point (fractions of the page box). */
export async function inkAlpha(page: Page, p: number, at: [number, number]): Promise<number> {
  return page.evaluate(
    ({ p, at }) => {
      const c = document.querySelector(`[data-page-overlay="${p}"] canvas`) as HTMLCanvasElement
      const px = c
        .getContext('2d')!
        .getImageData(Math.round(at[0] * c.width), Math.round(at[1] * c.height), 1, 1).data
      return px[3]
    },
    { p, at }
  )
}

export async function enableDrawWithMouse(page: Page): Promise<void> {
  await openReaderSettings(page)
  await page.getByRole('checkbox', { name: /draw with mouse/i }).check()
  await page.getByRole('button', { name: '← Back' }).click()
  await page.keyboard.press('Escape') // close the Display menu (keeps an active pen)
  await hideToolbar(page)
}

test('pen mode draws persistent ink (mouse only when enabled)', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await openAtSpread2(page)
    await page.keyboard.press('p')
    await expect(page.getByRole('group', { name: 'Pen options' })).toBeVisible()

    await stroke(page, 2, [0.4, 0.85], [0.7, 0.88])
    await page.waitForTimeout(300)
    expect((await stored(page)).ink).toEqual([])
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')

    await enableDrawWithMouse(page)
    await expect(page.getByRole('group', { name: 'Pen options' })).toBeVisible() // still in pen mode
    await stroke(page, 2, [0.4, 0.85], [0.7, 0.85])
    await expect.poll(async () => (await stored(page)).ink.length).toBe(1)
    const [s] = (await stored(page)).ink
    expect(s.page).toBe(2)
    for (const [x, y, p] of s.points) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
      expect(p).toBeGreaterThan(0)
    }
    expect(await inkAlpha(page, 2, [0.55, 0.85])).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Pen options' })).toHaveCount(0)
  } finally {
    await app.close()
  }

  ;({ app, page } = await launchApp(userData))
  try {
    await openAtSpread2(page)
    await expect.poll(() => inkAlpha(page, 2, [0.55, 0.85])).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})

test('eraser and undo/redo, limited to visible pages', async () => {
  const { app, page } = await launchApp()
  const count = async (): Promise<number> => (await stored(page)).ink.length
  try {
    await openAtSpread2(page)
    await enableDrawWithMouse(page)
    await page.keyboard.press('p')
    await stroke(page, 2, [0.3, 0.8], [0.7, 0.8])
    await stroke(page, 2, [0.3, 0.9], [0.7, 0.9])
    await expect.poll(count).toBe(2)

    await page.keyboard.press('Control+z')
    await expect.poll(count).toBe(1)
    await page.keyboard.press('Control+y')
    await expect.poll(count).toBe(2)

    await page.keyboard.press('e')
    await expect(page.getByRole('button', { name: 'Eraser' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await stroke(page, 2, [0.5, 0.75], [0.5, 0.85]) // crosses the first stroke only
    await expect.poll(count).toBe(1)
    expect(await inkAlpha(page, 2, [0.5, 0.8])).toBe(0)
    expect(await inkAlpha(page, 2, [0.5, 0.9])).toBeGreaterThan(0)
    await page.keyboard.press('Control+z')
    await expect.poll(count).toBe(2)

    await goToPage(page, 4)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '4,5')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    expect(await count()).toBe(2)
  } finally {
    await app.close()
  }
})
