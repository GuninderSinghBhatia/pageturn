import { test, expect, type Page } from '@playwright/test'
import axe from 'axe-core'
import { openAtSpread2, showToolbar, TEXT500 } from './annotationHelpers'
import { launchApp } from './helpers'

type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] }

/** Runs axe-core in the page (AxeBuilder needs a second page, which Electron cannot open). */
async function seriousViolations(page: Page): Promise<string[]> {
  const violations = (await page.evaluate(
    `${axe.source}; axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations)`
  )) as Violation[]
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`
    )
}

test('accessibility: no serious or critical problems in the library or the reader', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launchApp()
  try {
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    await expect(page.getByTestId('book-card')).toHaveCount(1)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      expect(await seriousViolations(page), `library (${theme})`).toEqual([])
    }
    await openAtSpread2(page, TEXT500)
    await showToolbar(page)
    expect(await seriousViolations(page), 'reader').toEqual([])
  } finally {
    await app.close()
  }
})
