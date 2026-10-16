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
  await waitForWindowFit(page)
  await goToPage(page, 2)
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

const toolbar = (page: Page): ReturnType<Page['getByRole']> =>
  page.getByRole('toolbar', { name: 'Reader tools' })

/** Whether the app considers the toolbar shown (not its CSS state mid-animation). */
const shown = async (page: Page): Promise<boolean> =>
  (await page.locator('[data-visible]').first().getAttribute('data-visible')) === 'true'

/** Reveals the hidden reader toolbar (T) if it isn't showing. */
export async function showToolbar(page: Page): Promise<void> {
  // Park the pointer mid-window: Chromium replays synthetic moves at the last pointer position,
  // and the test pointer starts at (0,0), inside the top reveal zone.
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  await page.mouse.move(vw.w / 2, vw.h / 2)
  const zone = page.locator('[data-visible]').first()
  // A hover-revealed toolbar is about to hide; let it, then open it for good with T.
  if (await shown(page))
    await expect(zone)
      .toHaveAttribute('data-visible', 'false', { timeout: 3000 })
      .catch(() => undefined)
  if (!(await shown(page))) await page.keyboard.press('t')
  await expect(page.locator('[data-visible]').first()).toHaveAttribute('data-visible', 'true')
  await expect(toolbar(page)).toBeVisible()
}

/** Hides the toolbar again unless a tool pins it. */
export async function hideToolbar(page: Page): Promise<void> {
  if (await shown(page)) await page.keyboard.press('t')
}

/** Types a page number into the toolbar's page box. */
export async function goToPage(page: Page, n: number): Promise<void> {
  await showToolbar(page)
  await page.getByTestId('page-box').fill(String(n))
  await page.getByTestId('page-box').press('Enter')
  await hideToolbar(page)
}

/** Clicks a button in the Display (Aa) menu, then closes the menu and toolbar. */
export async function displayAction(page: Page, name: string): Promise<void> {
  await showToolbar(page)
  await toolbar(page).getByRole('button', { name: 'Display' }).click()
  await page.getByRole('dialog', { name: 'Display' }).getByRole('button', { name }).click()
  await page.keyboard.press('Escape') // closes the menu
  await hideToolbar(page)
}

/** Opens Settings from the reader (Display menu → Settings…). */
export async function openReaderSettings(page: Page): Promise<void> {
  await showToolbar(page)
  await toolbar(page).getByRole('button', { name: 'Display' }).click()
  await page
    .getByRole('dialog', { name: 'Display' })
    .getByRole('button', { name: 'Settings' })
    .click()
}

/** The window reshapes to the book just after it opens; wait until its size holds still. */
export async function waitForWindowFit(page: Page): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => `${innerWidth}x${innerHeight}`)
        const stable = now === last
        last = now
        return stable
      },
      { intervals: [150, 150, 150, 250, 250] }
    )
    .toBe(true)
}
