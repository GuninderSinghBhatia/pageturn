// Screenshots of the landing page (desktop full page + mobile) for review.
//   CHROME_PATH=<chrome.exe> node scripts/demo-video/shoot-site.mjs [url]
import { chromium } from '@playwright/test'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:3100'
const out = join(import.meta.dirname, 'out')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })

async function shoot(name, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.screenshot({ path: join(out, `${name}-fold.png`) })
  // Scroll through so every reveal and tagline word fires, then capture the whole page.
  const h = await page.evaluate(() => document.body.scrollHeight)
  for (let y = 0; y < h; y += Math.round(viewport.height / 3)) {
    await page.evaluate((y) => window.scrollTo(0, y), y)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, `${name}-full.png`), fullPage: true })
  console.log(name, 'height', h, 'errors', errors)
  await page.close()
}

await shoot('desktop', { width: 1440, height: 900 })
await shoot('mobile', { width: 390, height: 844 })
await browser.close()
