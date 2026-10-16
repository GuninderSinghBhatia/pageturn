import { test, expect } from '@playwright/test'
import {
  bodyLine,
  dragSelect,
  goToPage,
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

test('right-click a selection: Make a note adds a dotted note with a margin dot; Ask AI shows a card', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const line = await bodyLine(page, 2)
    await dragSelect(page, line, line)
    await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Selection' })
    for (const name of ['Make a note', 'Ask AI', 'Look up', 'Highlight', 'Copy']) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible()
    }
    await menu.getByRole('menuitem', { name: 'Make a note' }).click()
    const note = page.getByRole('textbox', { name: 'Note' })
    await expect(note).toBeFocused()
    await note.fill('why does this hold?')
    await page.keyboard.press('Control+Enter')
    await expect(note).toHaveCount(0)
    await expect
      .poll(async () => {
        const a = await stored(page)
        return [a.highlights.map((h) => h.style), a.notes.map((n) => n.body)]
      })
      .toEqual([['note'], ['why does this hold?']])

    const dot = page.getByRole('button', { name: /^Margin note/ })
    await expect(dot).toBeVisible()
    await dot.click()
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('why does this hold?')
    await page.keyboard.press('Escape')

    const line3 = await bodyLine(page, 3)
    await dragSelect(page, line3, line3)
    await page.keyboard.press('a')
    const card = page.getByRole('dialog', { name: 'Ask AI' })
    await expect(card).toContainText('Coming soon')
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)

    // No selection: the page menu (free note) still works.
    const box = (await page.locator('[data-page-overlay="3"]').boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.92, { button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Add note here' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('bookmark tabs stick out of the right page: jump, rename, delete, hide', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const gear = page.getByRole('button', { name: 'Settings tab' })
    await expect(gear).toBeVisible()
    await page.keyboard.press('b') // bookmarks page 2
    await goToPage(page, 10)
    await page.keyboard.press('b') // page 10
    const tab1 = page.getByRole('button', { name: /^Bookmark 1, page 2/ })
    const tab2 = page.getByRole('button', { name: /^Bookmark 2, page 10/ })
    await expect(tab1).toBeVisible()
    await expect(tab2).toBeVisible()

    await tab1.click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')

    await page.getByRole('button', { name: /^Bookmark 2/ }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Bookmark name' }).fill('Results')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await stored(page)).bookmarks.map((b) => b.label))
      .toEqual([null, 'Results'])
    await expect(page.getByRole('button', { name: /^Bookmark 2, page 10: Results/ })).toBeVisible()

    await page.getByRole('button', { name: /^Bookmark 1/ }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect.poll(async () => (await stored(page)).bookmarks.map((b) => b.page)).toEqual([10])

    await page.evaluate(() => window.api.settings.set({ showBookmarkTabs: false }))
    await page.reload()
    await openAtSpread2(page)
    await expect(page.getByRole('button', { name: /^Bookmark 1/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Settings tab' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('after 2s without movement the cursor and toolbar hide; clicking the outer 15% turns', async () => {
  const { app, page } = await launchApp()
  try {
    await openAtSpread2(page)
    const reader = page.locator('[data-reader]')
    await page.mouse.move(300, 300)
    await page.mouse.move(310, 310)
    await expect(reader).toHaveAttribute('data-idle', 'false')
    await expect(reader).toHaveAttribute('data-idle', 'true', { timeout: 3500 })
    await page.mouse.move(320, 320)
    await expect(reader).toHaveAttribute('data-idle', 'false')

    // 32% of a page in from the edge (16% of the book) is outside the zone: no turn…
    const box = (await page.locator('[data-page-overlay="3"]').boundingBox())!
    await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.97)
    await page.waitForTimeout(800)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')
    // …but one in the outer 15% does.
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.97)
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '4,5')
  } finally {
    await app.close()
  }
})
