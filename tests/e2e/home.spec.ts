import { test, expect } from '@playwright/test'
import { bodyLine, dragSelect, openAtSpread2, showToolbar, TEXT500 } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

test('home: tabs and slider; a like survives a restart; a note opens its book at its page', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await expect(page.getByRole('tab')).toHaveText(['Books', 'Notes', 'Search Online', 'Settings'])
    const selected = page.getByRole('region', { name: 'Selected book' })
    await expect(selected.getByRole('heading', { name: 'Text 500' })).toBeVisible()
    await expect(selected.getByText(/500 pages · Page 1 \(0%\)/)).toBeVisible()
    await selected.getByRole('button', { name: 'Like Text 500' }).click()
    await expect(selected.getByRole('button', { name: 'Like Text 500' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    // Make a note on page 2, then go home.
    await openAtSpread2(page)
    const line = await bodyLine(page, 2)
    await dragSelect(page, line, line)
    await page.keyboard.press('n')
    await page.getByRole('textbox', { name: 'Note' }).fill('remember this')
    await page.keyboard.press('Control+Enter')
    await expect
      .poll(async () =>
        page.evaluate(async () => (await window.api.annotations.listAllNotes()).length)
      )
      .toBe(1)
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(userData))
  try {
    await expect(page.getByRole('button', { name: 'Like Text 500' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('tab', { name: 'Notes' }).click()
    await page.getByRole('button', { name: /remember this/ }).click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', '2,3')

    await showToolbar(page)
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('tab', { name: 'Search Online' }).click()
    await expect(page.getByText(/coming soon/i)).toBeVisible()
  } finally {
    await app.close()
  }
})
