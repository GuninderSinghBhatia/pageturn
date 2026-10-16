import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'

export const FIXTURES = join(__dirname, '..', 'fixtures')
export const TEXT500 = join(FIXTURES, 'text-500.pdf')

/** Imports a PDF (no-op if already in the library), opens it and goes to spread 2–3. */
export async function openAtSpread2(page: Page, file = TEXT500): Promise<void> {
  await page.evaluate((p) => window.api.library.import([p]), file)
  await page.getByTestId('book-card').getByRole('button').first().click()
  const stage = page.getByTestId('book-stage')
  await expect(stage).toHaveAttribute('data-settled', 'true')
  await page.getByTestId('page-box').fill('2')
  await page.getByTestId('page-box').press('Enter')
  await expect(stage).toHaveAttribute('data-pages', '2,3')
  await expect(stage).toHaveAttribute('data-settled', 'true')
  await page.waitForFunction(() => document.getAnimations().length === 0) // slide-in finished
}

type Box = { x: number; y: number; width: number; height: number; text: string }

/** Bounding boxes of the non-empty text spans on one page (waits for the text layer). */
export async function spans(page: Page, p: number): Promise<Box[]> {
  await expect(page.locator(`[data-page-overlay="${p}"] .textLayer`)).toHaveAttribute(
    'data-rendered',
    'true'
  )
  const loc = page.locator(`[data-page-overlay="${p}"] .textLayer span`)
  return loc.evaluateAll((els) =>
    els
      .map((e) => ({ r: e.getBoundingClientRect(), text: e.textContent ?? '' }))
      .filter(({ r, text }) => r.width > 0 && text.trim().length > 0)
      .map(({ r, text }) => ({ x: r.x, y: r.y, width: r.width, height: r.height, text }))
  )
}

/** The first body line (starts with "Lorem") on a page. */
export async function bodyLine(page: Page, p: number): Promise<Box> {
  return (await spans(page, p)).find((s) => s.text.startsWith('Lorem'))!
}

export async function dragSelect(page: Page, from: Box, to: Box): Promise<void> {
  await page.mouse.move(from.x + 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
}

/** Annotations of the first book in the library, straight from the database. */
export async function stored(
  page: Page
): Promise<import('../../src/shared/types').BookAnnotations> {
  return page.evaluate(async () => {
    const [book] = await window.api.library.list()
    return window.api.annotations.listForBook(book.id)
  })
}

/** Client point at the centre of a highlight's first rect. */
export async function highlightPoint(
  page: Page,
  hl: { page: number; rects: { x: number; y: number; w: number; h: number }[] }
): Promise<{ x: number; y: number }> {
  const box = (await page.locator(`[data-page-overlay="${hl.page}"]`).boundingBox())!
  const r = hl.rects[0]
  return { x: box.x + (r.x + r.w / 2) * box.width, y: box.y + (r.y + r.h / 2) * box.height }
}
