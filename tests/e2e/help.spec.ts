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
