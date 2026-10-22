import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { showToolbar, TEXT500 } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

test('notebook: lists highlights, filters by colour, jumps to a page, exports Markdown', async () => {
  test.setTimeout(60_000)
  const out = join(mkdtempSync(join(tmpdir(), 'pageturn-export-')), 'notes.md')
  const { app, page } = await launchApp(makeUserDataDir(), { PAGETURN_SAVE_PATH: out })
  try {
    await page.evaluate(async (file) => {
      const [book] = await window.api.library.import([file])
      const now = Date.now()
      for (const [p, color, text] of [
        [3, 'yellow', 'yellow passage on three'],
        [9, 'blue', 'blue passage on nine']
      ] as const) {
        await window.api.annotations.upsertHighlight({
          id: crypto.randomUUID(),
          bookId: book.id,
          page: p,
          rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }],
          text,
          color,
          style: 'highlight',
          noteId: null,
          createdAt: now,
          updatedAt: now
        })
      }
    }, TEXT500)
    await page.getByTestId('book-card').getByRole('button').first().click()
    await expect(page.getByTestId('book-stage')).toBeVisible()

    await page.keyboard.press('Control+b')
    const nb = page.getByRole('complementary', { name: 'Notebook' })
    await expect(nb.getByRole('listitem')).toHaveCount(2)
    await nb.getByRole('button', { name: 'Blue', exact: true }).click()
    await expect(nb.getByRole('listitem')).toHaveCount(1)

    await nb.getByRole('button', { name: /blue passage on nine/ }).click()
    await showToolbar(page)
    await expect(page.getByTestId('page-box')).toHaveValue('9')

    await nb.getByRole('button', { name: 'Export Markdown' }).click()
    await expect
      .poll(() => {
        try {
          return readFileSync(out, 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('## Page 9')
  } finally {
    await app.close()
  }
})
