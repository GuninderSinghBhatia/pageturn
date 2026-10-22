import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { bodyLine, dragSelect, FIXTURES, goToPage, openAtSpread2, spans } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

const HELP = join(FIXTURES, 'help.pdf')

async function selectLine(page: Page, p: number, first = false): Promise<void> {
  const line = first ? (await spans(page, p))[1] : await bodyLine(page, p)
  await dragSelect(page, line, line)
}

test('help panel: mock explanation, follow-up, rate-limit error, web tab, Esc', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launchApp(makeUserDataDir(), { PAGETURN_AI_MOCK: '1' })
  try {
    await page.evaluate(() => window.api.settings.setApiKey('anthropic', 'sk-test'))
    await openAtSpread2(page, HELP)

    await selectLine(page, 2)
    await page.keyboard.press('Control+e')
    const panel = page.getByRole('complementary', { name: 'Help' })
    await expect(panel).toBeVisible()
    // First use: the privacy line, then "Got it" sends the request.
    await panel.getByRole('button', { name: 'Got it' }).click()
    await expect(panel.getByText(/Mock explanation of:/)).toBeVisible({ timeout: 3000 })
    await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0) // answer finished

    const followUp = panel.getByRole('textbox', { name: 'Ask a follow-up' })
    await followUp.fill('what does it mean?')
    await followUp.press('Enter')
    await expect(panel.getByText(/Mock answer to: what does it mean\?/)).toBeVisible()

    // A passage the mock refuses with a 429.
    // Leave the follow-up box (single-key shortcuts are off while typing).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await goToPage(page, 4)
    await selectLine(page, 4, true)
    await page.keyboard.press('Control+e')
    await expect(panel.getByText(/rate limiting/i)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible()

    await panel.getByRole('tab', { name: 'Web' }).click()
    await expect(page.getByTestId('web-slot')).toHaveAttribute(
      'data-url',
      /^https:\/\/duckduckgo\.com\/\?q=/
    )
    const views = (): Promise<number> =>
      app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length
      )
    await expect.poll(views).toBe(1)

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect.poll(views).toBe(0)
  } finally {
    await app.close()
  }
})

test('help: Ctrl+E with no selection asks for one', async () => {
  const { app, page } = await launchApp(makeUserDataDir(), { PAGETURN_AI_MOCK: '1' })
  try {
    await openAtSpread2(page, HELP)
    await page.keyboard.press('Control+e')
    await expect(page.getByText('Select some text first')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Help' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('help: Save as note highlights the passage and keeps the explanation as its note', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launchApp(makeUserDataDir(), { PAGETURN_AI_MOCK: '1' })
  try {
    await page.evaluate(async () => {
      await window.api.settings.setApiKey('anthropic', 'sk-test')
      await window.api.settings.set({ aiPrivacyAcknowledged: true })
    })
    await page.reload() // settings are read at startup
    await openAtSpread2(page, HELP)
    await selectLine(page, 2)
    await page.keyboard.press('Control+e')
    const panel = page.getByRole('complementary', { name: 'Help' })
    await expect(panel.getByText(/Mock explanation of:/)).toBeVisible()
    await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0)

    const save = panel.getByRole('button', { name: 'Save as note' })
    await save.click()
    await expect(page.getByText('Saved to notes')).toBeVisible()
    await save.click() // twice: no second highlight
    const stored = async (): Promise<{ highlights: number; notes: string[] }> =>
      page.evaluate(async () => {
        const [book] = await window.api.library.list()
        const a = await window.api.annotations.listForBook(book.id)
        return { highlights: a.highlights.length, notes: a.notes.map((n) => n.body) }
      })
    await expect.poll(async () => (await stored()).highlights).toBe(1)
    const s = await stored()
    expect(s.notes).toHaveLength(1)
    expect(s.notes[0]).toMatch(/^\*\*Explanation \(AI\):\*\*\n\nMock explanation of:/)
  } finally {
    await app.close()
  }
})

test('help: leaving the book mid-answer cancels it; the API key never leaves secrets.bin', async () => {
  test.setTimeout(60_000)
  const userData = makeUserDataDir()
  const { app, page } = await launchApp(userData, { PAGETURN_AI_MOCK: '1' })
  try {
    await page.evaluate(async () => {
      await window.api.settings.setApiKey('anthropic', 'sk-test')
      await window.api.settings.set({ aiPrivacyAcknowledged: true })
    })
    await page.reload()
    await openAtSpread2(page, HELP)
    await selectLine(page, 2)
    await page.keyboard.press('Control+e')
    const panel = page.getByRole('complementary', { name: 'Help' })
    await expect(panel.getByText(/Mock/)).toBeVisible() // streaming has started
    await showToolbarAndBack(page)
    // Open another book straight away.
    await page.evaluate((p) => window.api.library.import([p]), join(FIXTURES, 'odd-3.pdf'))
    const cover = page.getByRole('button', { name: /^Open Text 3/ })
    await cover.click() // a side cover comes to the middle first
    await cover.click()
    await expect(page.getByTestId('book-stage')).toBeVisible()
    await page.waitForTimeout(1500) // the mock would have finished by now
    await expect(panel).toHaveCount(0)
    await expect(page.getByText(/Mock explanation/)).toHaveCount(0)

    // The key is only in secrets.bin, encrypted.
    const dump = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(dump).not.toContain('sk-test')
  } finally {
    await app.close()
  }
  const { readFileSync, readdirSync } = await import('node:fs')
  for (const f of readdirSync(userData).filter((n) => /\.(db|db-wal|bin)$/.test(n))) {
    expect(readFileSync(join(userData, f)).includes('sk-test'), f).toBe(false)
  }
  expect(readdirSync(userData)).toContain('secrets.bin')
})

async function showToolbarAndBack(page: Page): Promise<void> {
  await page.mouse.move(400, 300)
  await page.mouse.move(400, 4)
  await page.getByRole('button', { name: 'Back to library' }).click()
  await expect(page.getByTestId('book-card').first()).toBeVisible()
}
