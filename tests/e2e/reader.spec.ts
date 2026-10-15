import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, makeUserDataDir } from './helpers'

const fixture = (name: string): string => join(__dirname, '..', 'fixtures', name)

async function importBook(page: Page, file: string): Promise<void> {
  await page.evaluate((p) => window.api.library.import([p]), file)
  await expect(page.getByTestId('book-card')).toHaveCount(1)
}

test('opens fast, navigates with keys, and remembers the page', async () => {
  const userData = makeUserDataDir()
  let { app, page } = await launchApp(userData)
  try {
    await importBook(page, fixture('text-500.pdf'))
    const started = Date.now()
    await page.getByTestId('book-card').getByRole('button').first().click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
    expect(Date.now() - started).toBeLessThan(2000)

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
    }
    await expect(page.getByTestId('page-box')).toHaveValue('7')
    await page.waitForTimeout(700) // progress save is debounced 500 ms
  } finally {
    await app.close()
  }

  ;({ app, page } = await launchApp(userData))
  try {
    await page.getByTestId('book-card').getByRole('button').first().click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('page-box')).toHaveValue('7')

    await page.keyboard.press('Control+f')
    await page.getByTestId('find-input').fill('Page 250')
    await page.getByTestId('find-input').press('Enter')
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-pages', /\b250\b/, {
      timeout: 15_000
    })
  } finally {
    await app.close()
  }
})

test('prompts for a password and opens with the right one', async () => {
  const { app, page } = await launchApp()
  try {
    await importBook(page, fixture('password.pdf'))
    await page.getByTestId('book-card').getByRole('button').first().click()
    const input = page.getByTestId('password-input')
    await input.fill('wrong')
    await input.press('Enter')
    await expect(page.getByText(/incorrect password/i)).toBeVisible()
    await input.fill('test')
    await input.press('Enter')
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
  } finally {
    await app.close()
  }
})

test('cancelling the password prompt returns to the library', async () => {
  const { app, page } = await launchApp()
  try {
    await importBook(page, fixture('password.pdf'))
    await page.getByTestId('book-card').getByRole('button').first().click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('book-card')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
