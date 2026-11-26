// Hands-on check of the AI features in the real app (not part of the video pipeline).
// Uses a COPY of the real data folder (for the API keys), so the real library is untouched.
//   RAG_BOOK=<indexed pdf> npx tsx scripts/demo-video/check-ai.ts
import { launch } from '../../tests/tauri/helpers'
import { copyFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = join(__dirname, 'out', 'check')
const REAL = join(process.env.APPDATA!, 'PageTurn')
// The PDF the rag-service has indexed: RAG_BOOK=<path to it> npx tsx scripts/demo-video/check-ai.ts
const RAG_BOOK = process.env.RAG_BOOK ?? ''
if (!RAG_BOOK) throw new Error('Set RAG_BOOK to the indexed PDF')
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let browserRef: import('@playwright/test').Browser
/** Every page in the WebView2 process other than the app itself: the in-app web views. */
async function webViews(name: string): Promise<void> {
  const pages = browserRef.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().includes('localhost:5174'))
  console.log(name, 'web views:', pages.map((p) => p.url()))
  let i = 0
  for (const p of pages) {
    console.log('  title:', await p.title().catch(() => '?'))
    await p.screenshot({ path: join(OUT, `${name}-${i++}.png`) }).catch((e) => console.log('  shot failed', String(e).slice(0, 80)))
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const data = mkdtempSync(join(tmpdir(), 'pageturn-check-'))
  for (const f of ['pageturn.db', 'pageturn.db-wal', 'pageturn.db-shm', 'secrets.bin'])
    if (existsSync(join(REAL, f))) copyFileSync(join(REAL, f), join(data, f))
  const r = await launch(data)
  const { page } = r
  browserRef = r.browser
  const log = (...a: unknown[]): void => console.log(...a)
  try {
    const keys = await page.evaluate(async () => ({
      anthropic: await window.api.settings.hasApiKey('anthropic'),
      openai: await window.api.settings.hasApiKey('openai'),
      gemini: await window.api.settings.hasApiKey('gemini')
    }))
    log('api keys present:', keys)
    log('rag health:', await page.evaluate(() => (window.api as any).rag.health()))

    // Open the indexed book (import is a no-op if it is already in the library).
    await page.evaluate((p) => window.api.library.import([p]), RAG_BOOK)
    const books = await page.evaluate(() => window.api.library.list())
    const book = books.find((b: any) => b.filePath === RAG_BOOK) ?? books[0]
    log('library books:', books.length, 'rag book:', book?.title)
    await page.getByRole('button', { name: `Open ${book!.title}` }).click()
    await wait(1200)
    await page.getByRole('region', { name: 'Selected book' }).getByRole('button', { name: /reading/i }).first().click()
    await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]', { timeout: 60_000 })
    await wait(1500)
    // Go to page 651 (LoRA) via the page box.
    await page.keyboard.press('t')
    await page.getByTestId('page-box').fill('651')
    await page.getByTestId('page-box').press('Enter')
    await wait(2500)
    await page.keyboard.press('Escape')

    // 1. Ask the book (RAG).
    await page.keyboard.press('t')
    await page.getByRole('toolbar', { name: 'Reader tools' }).getByRole('button', { name: 'Ask the book' }).click()
    const ask = page.getByRole('complementary', { name: 'Ask the book' })
    await ask.getByRole('textbox', { name: 'Question' }).fill('What is fine-tuning?')
    await ask.getByRole('textbox', { name: 'Question' }).press('Enter')
    const t0 = Date.now()
    await wait(20_000)
    log('ask answer after', Date.now() - t0, 'ms:', (await ask.getByRole('status').innerText()).slice(0, 400))
    await page.screenshot({ path: join(OUT, '1-ask-the-book.png') })
    const cite = ask.getByRole('button', { name: /page|p\.\s?\d/i }).first()
    if (await cite.count()) {
      await cite.click()
      await wait(2000)
      log('after citation click, stage pages:', await page.getByTestId('book-stage').getAttribute('data-pages'))
    }
    await page.keyboard.press('Escape')
    await wait(800)
    // 1b. Who is this? on a word from the right-click menu.
    const term = page.locator('[data-page-overlay] .textLayer span').filter({ hasText: /finetuning|fine-tuning/i }).first()
    const tb = await term.evaluate((el) => {
      const node = el.firstChild!
      const i = node.textContent!.search(/fine-?tuning/i)
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + 6)
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await page.mouse.dblclick(tb.x, tb.y)
    await page.mouse.click(tb.x, tb.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Who is this?' }).click()
    await wait(25_000)
    log('who answer:', (await ask.innerText()).slice(0, 600))
    await page.screenshot({ path: join(OUT, '1b-who-is-this.png') })
    return
    // 4. Search Online tab on the home screen.
    await page.keyboard.press('t')
    await page.getByRole('button', { name: 'Back to library' }).click()
    await wait(1500)
    await page.getByRole('tab', { name: 'Search Online' }).click()
    await page.getByRole('textbox', { name: 'Search online' }).fill('Alice in Wonderland free pdf')
    await page.getByRole('textbox', { name: 'Search online' }).press('Enter')
    await wait(6000)
    await webViews('4-search-online')
    await page.screenshot({ path: join(OUT, '4-search-online-page.png') })
  } finally {
    await r.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
