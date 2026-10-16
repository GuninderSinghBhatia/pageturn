import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, makeUserDataDir } from './helpers'

const TEXT500 = join(__dirname, '..', 'fixtures', 'text-500.pdf')

test('imported book appears with a cover and survives restart', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    const card = page.getByTestId('book-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('img')).toBeVisible({ timeout: 5000 })
    await expect(card.getByTestId('book-title')).toHaveText('Text 500')
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(userData))
  try {
    await expect(page.getByTestId('book-card')).toHaveCount(1)
    await expect(page.getByTestId('book-card').locator('img')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('remove asks whether to keep annotations; kept ones return on re-import', async () => {
  const { app, page } = await launchApp()
  try {
    const [book] = await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await page.evaluate((id) => window.api.annotations.toggleBookmark(id, 4), book.id)
    const bookmarks = (): Promise<number> =>
      page.evaluate(
        async (id) => (await window.api.annotations.listForBook(id)).bookmarks.length,
        book.id
      )

    const remove = async (deleteAnnotations: boolean): Promise<void> => {
      await page.getByTestId('book-card').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Remove from library' }).click()
      const dialog = page.getByRole('dialog', { name: 'Remove book' })
      const box = dialog.getByRole('checkbox', {
        name: 'Also delete highlights, notes and drawings'
      })
      await expect(box).not.toBeChecked()
      if (deleteAnnotations) await box.check()
      await dialog.getByRole('button', { name: 'Remove' }).click()
      await expect(page.getByTestId('book-card')).toHaveCount(0)
    }

    await remove(false)
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await expect(page.getByTestId('book-card')).toHaveCount(1)
    expect(await bookmarks()).toBe(1)

    await remove(true)
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await expect(page.getByTestId('book-card')).toHaveCount(1)
    expect(await bookmarks()).toBe(0)
  } finally {
    await app.close()
  }
})
