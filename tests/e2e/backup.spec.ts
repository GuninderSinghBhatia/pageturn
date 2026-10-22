import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEXT500 } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

test('backup: export, delete a highlight, import brings it back; a daily backup exists', async () => {
  test.setTimeout(60_000)
  const file = join(mkdtempSync(join(tmpdir(), 'pageturn-bk-')), 'backup.json')
  const userData = makeUserDataDir()
  const { app, page } = await launchApp(userData, { PAGETURN_SAVE_PATH: file })
  try {
    const hl = await page.evaluate(async (pdf) => {
      const [book] = await window.api.library.import([pdf])
      const now = Date.now()
      const h = {
        id: crypto.randomUUID(),
        bookId: book.id,
        page: 4,
        rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }],
        text: 'keep me safe',
        color: 'green' as const,
        style: 'highlight' as const,
        noteId: null,
        createdAt: now,
        updatedAt: now
      }
      await window.api.annotations.upsertHighlight(h)
      return { id: h.id, bookId: book.id }
    }, TEXT500)

    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Export backup (JSON)' }).click()
    await expect(page.getByText(/Backup saved/)).toBeVisible()
    expect(existsSync(file)).toBe(true)

    await page.evaluate((id) => window.api.annotations.deleteHighlight(id), hl.id)
    await page.getByRole('button', { name: 'Import backup' }).click()
    await expect(page.getByText(/Imported: 1 added/)).toBeVisible()
    const texts = await page.evaluate(
      async (bookId) =>
        (await window.api.annotations.listForBook(bookId)).highlights.map((h) => h.text),
      hl.bookId
    )
    expect(texts).toEqual(['keep me safe'])
  } finally {
    await app.close()
  }
  expect(
    readdirSync(join(userData, 'backups')).some((f) => /^pageturn-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  ).toBe(true)
})
