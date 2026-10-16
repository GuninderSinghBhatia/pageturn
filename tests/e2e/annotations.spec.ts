import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import {
  bodyLine,
  displayAction,
  dragSelect,
  FIXTURES,
  highlightPoint,
  openAtSpread2,
  spans,
  stored
} from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

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

test('highlight + note persist across a restart (spec e2e)', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await openAtSpread2(page)
    const line = await bodyLine(page, 2)
    await dragSelect(page, line, line)
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Highlight' }).click()
    await expect.poll(async () => (await stored(page)).highlights.length).toBe(1)
    const [hl] = (await stored(page)).highlights
    expect(hl).toMatchObject({ page: 2, color: 'yellow' })
    expect(hl.text).toContain('Lorem ipsum')

    const pt = await highlightPoint(page, hl)
    await page.mouse.click(pt.x, pt.y)
    const popover = page.getByRole('dialog', { name: 'Highlight' })
    await popover.getByRole('button', { name: 'Add note' }).click()
    await popover.getByRole('textbox', { name: 'Note' }).fill('check this')
    await expect
      .poll(async () => (await stored(page)).notes.map((n) => n.body))
      .toEqual(['check this'])
  } finally {
    await app.close()
  }

  ;({ app, page } = await launchApp(userData))
  try {
    await openAtSpread2(page)
    const [hl] = (await stored(page)).highlights
    const pt = await highlightPoint(page, hl)
    // The overlay canvas is painted under the highlight.
    const alpha = await page.evaluate(({ x, y }) => {
      const c = document.querySelector('[data-page-overlay="2"] canvas') as HTMLCanvasElement
      const b = c.getBoundingClientRect()
      const px = c
        .getContext('2d')!
        .getImageData(
          Math.round(((x - b.left) / b.width) * c.width),
          Math.round(((y - b.top) / b.height) * c.height),
          1,
          1
        ).data
      return px[3]
    }, pt)
    expect(alpha).toBeGreaterThan(0)
    await page.mouse.click(pt.x, pt.y)
    await expect(
      page.getByRole('dialog', { name: 'Highlight' }).getByRole('textbox', { name: 'Note' })
    ).toHaveValue('check this')
  } finally {
    await app.close()
  }
})

test('a selection across both pages makes one highlight per page (Review Focus 2)', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const last = (await spans(page, 2)).at(-1)!
    const first = await bodyLine(page, 3)
    await dragSelect(page, last, first)
    await page.keyboard.press('h')
    await expect.poll(async () => (await stored(page)).highlights.length).toBe(2)
    const hs = (await stored(page)).highlights.sort((a, b) => a.page - b.page)
    expect(hs.map((h) => h.page)).toEqual([2, 3])
    expect(hs[0].text).toContain('pariatur')
    expect(hs[0].text).not.toContain('Page 3')
    expect(hs[1].text).toContain('Page 3')
    expect(hs[1].text).not.toContain('pariatur')
    for (const h of hs) {
      for (const r of h.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(1)
        expect(r.y + r.h).toBeLessThanOrEqual(1)
      }
    }
  } finally {
    await app.close()
  }
})

test('highlights stay clickable after layout and zoom changes (Review Focus 5); delete removes them', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const line = await bodyLine(page, 2)
    await dragSelect(page, line, line)
    await page.keyboard.press('h')
    await expect.poll(async () => (await stored(page)).highlights.length).toBe(1)
    const [hl] = (await stored(page)).highlights
    const popover = page.getByRole('dialog', { name: 'Highlight' })
    const stage = page.getByTestId('book-stage')

    const clickHighlight = async (): Promise<void> => {
      await expect(stage).toHaveAttribute('data-settled', 'true')
      await page.waitForFunction(() => document.getAnimations().length === 0)
      const pt = await highlightPoint(page, hl)
      await page.mouse.click(pt.x, pt.y)
      await expect(popover).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
    }

    await clickHighlight()
    await displayAction(page, 'Single page')
    await clickHighlight()
    await displayAction(page, 'Two pages')
    await displayAction(page, 'Zoom in')
    await clickHighlight()
    await displayAction(page, 'Zoom out')
    await clickHighlight()

    const pt = await highlightPoint(page, hl)
    await page.mouse.click(pt.x, pt.y)
    await popover.getByRole('button', { name: 'Add note' }).click()
    await popover.getByRole('textbox', { name: 'Note' }).fill('gone soon')
    await expect.poll(async () => (await stored(page)).notes.length).toBe(1)
    await popover.getByRole('button', { name: 'Delete highlight' }).click()
    await expect.poll(async () => stored(page)).toMatchObject({ highlights: [], notes: [] })
  } finally {
    await app.close()
  }
})

test('a free note added by right-click persists across a restart', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await openAtSpread2(page)
    const box = (await page.locator('[data-page-overlay="3"]').boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Add note here' }).click()
    await page.getByRole('textbox', { name: 'Note' }).fill('remember')
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.05) // click elsewhere
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveCount(0)
    await expect
      .poll(async () => (await stored(page)).notes)
      .toMatchObject([{ page: 3, body: 'remember', anchor: { point: {} } }])
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(userData))
  try {
    await openAtSpread2(page)
    await page.locator('[data-page-overlay="3"]').getByRole('button', { name: /^Note/ }).click()
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('remember')
  } finally {
    await app.close()
  }
})

test('Ctrl+D bookmarks the left page of the spread and survives a restart', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  const ribbon = (p: typeof page): ReturnType<typeof page.getByRole> =>
    p.getByRole('button', { name: 'Bookmark page 2' })
  try {
    await openAtSpread2(page)
    await expect(ribbon(page)).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Control+d')
    await expect(ribbon(page)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await stored(page)).bookmarks.map((b) => b.page)).toEqual([2])
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(userData))
  try {
    await openAtSpread2(page)
    await expect(ribbon(page)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Control+d')
    await expect(ribbon(page)).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Bookmark page 3' }).click()
    await expect.poll(async () => (await stored(page)).bookmarks.map((b) => b.page)).toEqual([3])
  } finally {
    await app.close()
  }
})

test('annotations are baked into the curling page and overlays hide mid-turn', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const line = await bodyLine(page, 3)
    await dragSelect(page, line, line)
    await page.keyboard.press('h')
    await expect.poll(async () => (await stored(page)).highlights.length).toBe(1)

    const stage = page.getByTestId('book-stage')
    const [x, y, w, h] = (await stage.getAttribute('data-right-rect'))!.split(',').map(Number)
    const box = (await stage.boundingBox())!
    await page.mouse.move(box.x + x + w - 3, box.y + y + h - 3)
    await page.mouse.down()
    await page.mouse.move(box.x + x + w * 0.5, box.y + y + h * 0.7, { steps: 6 })
    await expect(stage).toHaveAttribute('data-settled', 'false')
    expect((await stage.getAttribute('data-baked'))!.split(',')).toContain('3')
    await expect(page.locator('[data-page-overlay="3"]')).toBeHidden()
    await page.mouse.move(box.x + x + w - 3, box.y + y + h - 3, { steps: 4 }) // back: cancel
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-settled', 'true')
    await expect(stage).toHaveAttribute('data-pages', '2,3')
    await expect(page.locator('[data-page-overlay="3"]')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('scrolling the wheel over an open note does not turn the page', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const box = (await page.locator('[data-page-overlay="3"]').boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Add note here' }).click()
    const note = page.getByRole('textbox', { name: 'Note' })
    await note.fill('line\n'.repeat(30))
    const nb = (await note.boundingBox())!
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2)
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(800)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')
    await expect(note).toBeVisible()
  } finally {
    await app.close()
  }
})
