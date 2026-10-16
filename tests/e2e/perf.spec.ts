import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApp } from './helpers'

const TEXT1000 = join(__dirname, '..', 'fixtures', 'text-1000.pdf')

test('page turns hold p95 frame time ≤ 20 ms on the 1000-page fixture', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
    await page.evaluate((p) => window.api.library.import([p]), TEXT1000)
    await page.getByTestId('book-card').getByRole('button').first().click()
    const stage = page.getByTestId('book-stage')
    await expect(stage).toHaveAttribute('data-stage', 'curl')
    await expect(stage).toHaveAttribute('data-settled', 'true')

    // Record frame deltas only while a turn is in progress.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] }
      w.__frames = []
      let last = performance.now()
      const loop = (now: number): void => {
        const el = document.querySelector('[data-testid="book-stage"]')
        if (el?.getAttribute('data-settled') === 'false') w.__frames.push(now - last)
        last = now
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowRight')
      await expect(stage).toHaveAttribute('data-settled', 'false')
      await expect(stage).toHaveAttribute('data-settled', 'true')
    }

    const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)
    const sorted = [...frames].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    console.log(
      `frames=${frames.length} p95=${p95.toFixed(1)}ms max=${sorted.at(-1)!.toFixed(1)}ms`
    )
    expect(frames.length).toBeGreaterThan(100)
    expect(p95).toBeLessThanOrEqual(20)
  } finally {
    await app.close()
  }
})
