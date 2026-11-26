// Films the real PageTurn app for the landing-page demo video, in real time.
//
//   1. node scripts/demo-video/make-book.mjs           (the demo book)
//   2. rag-service running on :8000 with the book indexed (see README.md here)
//   3. npx vite --config vite.tauri.config.ts          (dev server the debug app loads)
//   4. npx tsx scripts/demo-video/record.ts            (this: out/capture.mkv + out/capture.json)
//   5. node scripts/demo-video/compose.mjs             (titles + captions → site/public/video/)
//
// The maximized app window is filmed with Windows Graphics Capture (ffmpeg gfxcapture) at the
// screen's own rate (up to 144 fps), and compose.mjs resamples it to an even 60 fps. (The CDP
// screencast used before dropped to ~35 fps with long freezes; the app itself renders at 144.)
// A magenta flash at the start ties scene markers to video time. The OS pointer isn't filmed:
// a drawn pointer follows the page's own pointer events. Rects of where the action is are saved
// with the markers so the edit can zoom in on them.
import type { Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { launch, makeUserData } from '../../tests/tauri/helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(__dirname, 'out')
const CAPTURE = join(OUT, 'capture.mkv')
const BOOK = join(OUT, 'alice.pdf')

type Rect = { x: number; y: number; w: number; h: number }
const markers: { name: string; t: number; rect?: Rect }[] = []
const now = (): number => Date.now() / 1000
const mark = (name: string, rect?: Rect): void => {
  markers.push({ name, t: now(), rect })
  console.log('scene', name)
}
/** A locator's box in CSS pixels, for the edit's camera. */
async function rectOf(sel: ReturnType<Page['locator']>): Promise<Rect | undefined> {
  const b = await sel.boundingBox().catch(() => null)
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : undefined
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- Drawn pointer: follows real pointer events inside the page --------------------------------

const CURSOR_JS = `(() => {
  if (document.getElementById('demo-cursor')) return
  const c = document.createElement('div')
  c.id = 'demo-cursor'
  c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27 L17 25.2 L13 17 L21 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
    transform: 'translate(-100px,-100px)', transformOrigin: '3px 2px', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', willChange: 'transform' })
  const ring = document.createElement('div')
  Object.assign(ring.style, { position: 'fixed', left: '0', top: '0', width: '36px', height: '36px',
    margin: '-18px 0 0 -18px', borderRadius: '50%', border: '2px solid rgba(232,163,61,.95)',
    zIndex: '2147483646', pointerEvents: 'none', opacity: '0' })
  document.documentElement.append(ring, c)
  const move = (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px) scale(1.15)' }
  addEventListener('pointermove', move, { capture: true, passive: true })
  addEventListener('pointerdown', (e) => {
    move(e)
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'
    ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }],
      { duration: 420, easing: 'cubic-bezier(0.16,1,0.3,1)' })
  }, { capture: true, passive: true })
})()`

let pos = { x: 640, y: 500 }

async function ensureCursor(page: Page): Promise<void> {
  await page.evaluate(CURSOR_JS)
  await page.mouse.move(pos.x, pos.y)
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Moves the pointer along an eased path at 60 moves a second, paced by the wall clock. */
async function glide(page: Page, x: number, y: number, ms = 450): Promise<void> {
  const from = { ...pos }
  const start = Date.now()
  for (;;) {
    const k = Math.min(1, (Date.now() - start) / ms)
    const e = ease(k)
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    if (k >= 1) break
    const next = start + Math.ceil((Date.now() - start + 1) / 16) * 16
    await wait(Math.max(0, next - Date.now()))
  }
  pos = { x, y }
}

async function clickAt(page: Page, x: number, y: number, opts: { button?: 'right' } = {}): Promise<void> {
  await glide(page, x, y)
  await wait(80)
  await page.mouse.click(x, y, opts)
}

async function clickEl(page: Page, sel: ReturnType<Page['locator']>): Promise<void> {
  const b = (await sel.boundingBox())!
  await clickAt(page, b.x + b.width / 2, b.y + b.height / 2)
}

/** Drag with the button held (selection, ink, page curl). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms = 600): Promise<void> {
  await glide(page, from.x, from.y)
  await wait(60)
  await page.mouse.down()
  await glide(page, to.x, to.y, ms)
  await wait(40)
  await page.mouse.up()
}

async function stroke(page: Page, pts: { x: number; y: number }[], ms = 900): Promise<void> {
  await glide(page, pts[0].x, pts[0].y)
  await page.mouse.down()
  const per = ms / (pts.length - 1)
  for (const p of pts.slice(1)) await glide(page, p.x, p.y, per)
  await page.mouse.up()
}

// ---- Text targets ------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number; text: string }

async function spans(page: Page, p: number): Promise<Box[]> {
  await page.waitForSelector(`[data-page-overlay="${p}"] .textLayer[data-rendered="true"]`)
  return page.locator(`[data-page-overlay="${p}"] .textLayer span`).evaluateAll((els) =>
    els
      .map((e) => ({ r: e.getBoundingClientRect(), text: e.textContent ?? '' }))
      .filter(({ r, text }) => r.width > 0 && text.trim().length > 0)
      .map(({ r, text }) => ({ x: r.x, y: r.y, width: r.width, height: r.height, text }))
  )
}

/** Exact client rect of `text` on page `p` (measured with a DOM Range on the text layer). */
async function find(page: Page, p: number, text: string): Promise<{ x0: number; x1: number; y: number; h: number }> {
  await page.waitForSelector(`[data-page-overlay="${p}"] .textLayer[data-rendered="true"]`, { timeout: 5000 })
  const r = await page.evaluate(
    ({ p, text }) => {
      for (const el of document.querySelectorAll(`[data-page-overlay="${p}"] .textLayer span`)) {
        const node = el.firstChild
        const i = node?.textContent?.indexOf(text) ?? -1
        if (!node || i < 0) continue
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + text.length)
        const b = range.getBoundingClientRect()
        return { x0: b.left, x1: b.right, y: b.top + b.height / 2, h: b.height }
      }
      return null
    },
    { p, text }
  )
  if (!r) throw new Error(`"${text}" not on page ${p}`)
  return r
}

/** Selects one word or phrase exactly; returns its centre. */
async function selectText(page: Page, p: number, text: string, ms = 420): Promise<{ x: number; y: number }> {
  const w = await find(page, p, text)
  await drag(page, { x: w.x0 + 1, y: w.y }, { x: w.x1 - 1, y: w.y }, ms)
  return { x: (w.x0 + w.x1) / 2, y: w.y }
}

// ---- Toolbar -----------------------------------------------------------------------------------

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Reader tools' })

async function revealToolbar(page: Page): Promise<void> {
  await glide(page, pos.x, 8, 420)
  await toolbar(page).waitFor({ state: 'visible' })
  await wait(350)
}

async function tool(page: Page, name: string): Promise<void> {
  if (!(await toolbar(page).isVisible())) await revealToolbar(page)
  await clickEl(page, toolbar(page).getByRole('button', { name, exact: true }))
}

/** Turns pages with the arrow keys (real page turns) until the spread starting at `n` shows. */
async function goToPage(page: Page, n: number): Promise<void> {
  const stage = page.getByTestId('book-stage')
  for (let i = 0; i < 20; i++) {
    const pages = ((await stage.getAttribute('data-pages')) ?? '').split(',').map(Number)
    if (pages.includes(n)) break
    await page.keyboard.press(pages[0] > n ? 'ArrowLeft' : 'ArrowRight')
    await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]')
    await wait(700)
  }
  await wait(300)
}

// ---- Capture ------------------------------------------------------------------------------------

/** Windows Graphics Capture of the app window, every frame the compositor makes (up to 144 fps). */
function startCapture(): ChildProcess {
  return spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-filter_complex',
    'gfxcapture=window_exe=(?i)pageturn:capture_cursor=0:max_framerate=144,hwdownload,format=bgra,format=nv12[v]',
    // NVENC: a CPU encoder at 144 fps competed with the app and fell seconds behind.
    '-map', '[v]', '-fps_mode', 'passthrough', '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'constqp',
    '-qp', '16', CAPTURE],
    { stdio: ['pipe', 'inherit', 'inherit'] })
}

async function stopCapture(ff: ChildProcess): Promise<void> {
  if (ff.exitCode !== null) return
  const done = new Promise((r) => ff.on('exit', r))
  ff.stdin!.write('q')
  ff.stdin!.end()
  await done
}

/** Shows a magenta frame for a moment; returns the wall time it was on screen. */
async function flash(page: Page): Promise<number> {
  return (await page.evaluate(`new Promise((res) => {
    const d = document.createElement('div')
    Object.assign(d.style, { position: 'fixed', inset: '0', background: '#ff00ff', zIndex: '2147483647' })
    document.documentElement.append(d)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const t = Date.now() / 1000
      setTimeout(() => { d.remove(); res(t) }, 250)
    }))
  })`)) as number
}

// ---- The film ----------------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const r = await launch(makeUserData())
  let ff: ChildProcess | undefined
  let flashT = 0
  const { page } = r
  try {
    // Off camera: the book in the library; pen works with a mouse; the Ask service is up.
    await page.evaluate((p) => window.api.library.import([p]), BOOK)
    await page.evaluate(() => window.api.settings.set({ drawWithMouse: true }))
    await page.reload()
    await page.waitForFunction(() => typeof window.api?.library?.list === 'function')
    const health = await page.evaluate(() => window.api.rag.health())
    if (!health.ok) throw new Error('rag-service is not running on :8000')
    await page.getByRole('button', { name: /Start reading/ }).waitFor()
    if (!(await page.evaluate(() => window.api.window.getState())).maximized)
      await page.evaluate(() => window.api.window.control('toggleMaximize'))
    await wait(1500)
    await ensureCursor(page)

    ff = startCapture()
    await wait(1500)
    flashT = await flash(page)
    await wait(600)

    // 1 · Shelf → open the book
    mark('shelf')
    await glide(page, 760, 520, 600)
    await wait(400)
    await clickEl(page, page.getByRole('button', { name: /Start reading/ }))
    await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]')
    await ensureCursor(page)
    await wait(300)
    mark('opened')
    await wait(700)

    // 2 · Page turns: two key presses, then a hand drag of the page corner
    mark('flip')
    const stage = page.getByTestId('book-stage')
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('ArrowRight')
      await wait(1100)
    }
    // The page edge, not the stage's: maximized, the book sits mid-stage.
    const [l0, r0] = ((await stage.getAttribute('data-pages')) ?? '4,5').split(',').map(Number)
    const lb = (await page.locator(`[data-page-overlay="${l0}"]`).boundingBox())!
    const rb0 = (await page.locator(`[data-page-overlay="${r0}"]`).boundingBox())!
    await drag(
      page,
      { x: rb0.x + rb0.width - 14, y: rb0.y + rb0.height * 0.82 },
      { x: lb.x + lb.width * 0.36, y: rb0.y + rb0.height * 0.6 },
      1100
    )
    await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]')
    await wait(700)
    if (((await stage.getAttribute('data-pages')) ?? '').split(',').map(Number).includes(r0)) {
      console.log('drag did not turn the page; using the arrow key')
      await page.keyboard.press('ArrowRight')
      await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]')
      await wait(700)
    }
    const [left, right] = ((await stage.getAttribute('data-pages')) ?? '6,7').split(',').map(Number)
    console.log('spread', left, right)

    // 3 · Toolbar appears from the top edge
    mark('toolbar')
    await revealToolbar(page)
    await glide(page, pos.x + 240, 30, 600)
    await wait(500)

    // 4 · Highlighter and wavy underline
    const body = (await spans(page, left)).filter((s) => s.text.length > 30)
    mark('highlight', { x: body[3].x - 30, y: body[3].y - 60, w: body[3].width + 60, h: body[8].y - body[3].y + 120 })
    await tool(page, 'Highlighter')
    await wait(300)
    const line = async (b: Box, frac = 1, ms = 650): Promise<void> =>
      drag(page, { x: b.x + 1, y: b.y + b.height / 2 }, { x: b.x + b.width * frac - 1, y: b.y + b.height / 2 }, ms)
    await line(body[3])
    await wait(250)
    await line(body[4], 0.6, 500)
    await wait(400)
    await tool(page, 'Underline')
    await wait(200)
    await clickEl(page, page.getByRole('button', { name: 'Wavy' })).catch(() => undefined)
    await line(body[8])
    await wait(400)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await wait(500)

    // 5 · A note on a selection (right-click menu)
    const rightSpans = (await spans(page, right)).filter((s) => s.text.length > 30)
    const n1 = rightSpans[2]
    mark('note', { x: n1.x - 40, y: n1.y - 120, w: n1.width + 260, h: 360 })
    await drag(page, { x: n1.x + n1.width * 0.25, y: n1.y + n1.height / 2 }, { x: n1.x + n1.width - 1, y: n1.y + n1.height / 2 }, 550)
    await clickAt(page, n1.x + n1.width * 0.6, n1.y + n1.height / 2, { button: 'right' })
    await wait(350)
    await clickEl(page, page.getByRole('menuitem', { name: 'Make a note' }))
    await page.getByRole('textbox', { name: 'Note' }).last().waitFor()
    await page.keyboard.type('She falls for ages. Carroll stretches time here.', { delay: 32 })
    await wait(700)
    await page.keyboard.press('Escape')
    await wait(500)

    // 6 · Ask the book (RAG): question → cited answer → jump to the cited page
    mark('ask')
    await tool(page, 'Ask the book')
    const ask = page.getByRole('complementary', { name: 'Ask the book' })
    const qBox = ask.getByRole('textbox', { name: 'Question' })
    await qBox.waitFor()
    await wait(350)
    mark('ask-open', await rectOf(ask))
    await clickEl(page, qBox)
    await page.keyboard.type('What does Alice wonder while she is falling?', { delay: 34 })
    await wait(250)
    await page.keyboard.press('Enter')
    mark('ask-sent')
    await ask.getByText(/Passages used/i).waitFor({ timeout: 90_000 })
    mark('ask-answered', await rectOf(ask))
    await wait(2600)
    const cite = ask.getByRole('button', { name: /p\.\s?\d+/ }).first()
    if (await cite.count()) {
      mark('ask-cite', await rectOf(cite))
      await clickEl(page, cite)
      await page.waitForSelector('[data-testid="book-stage"][data-settled="true"]')
      await wait(1400)
    }

    // 7 · Who is this? on a name (right-click menu); Dinah first appears on page 5
    mark('who')
    const tryDinah = async (): Promise<{ x: number; y: number } | null> => {
      const [l] = ((await stage.getAttribute('data-pages')) ?? '4,5').split(',').map(Number)
      for (const p of [l, l + 1]) {
        const at = await selectText(page, p, 'Dinah').catch(() => null)
        if (at) return at
      }
      return null
    }
    let target = await tryDinah()
    if (!target) {
      await goToPage(page, 5)
      target = await tryDinah()
    }
    await clickAt(page, target!.x, target!.y, { button: 'right' })
    await wait(350)
    await clickEl(page, page.getByRole('menuitem', { name: 'Who is this?' }))
    mark('who-sent')
    await page.waitForFunction(
      () => (document.querySelector('aside[aria-label="Ask the book"]')?.textContent ?? '').match(/Dinah[^?]*cat/i),
      undefined,
      { timeout: 90_000 }
    )
    mark('who-answered', await rectOf(page.getByRole('complementary', { name: 'Ask the book' })))
    await wait(2800)
    await clickEl(page, page.getByRole('button', { name: 'Close ask panel' })).catch(() => undefined)
    await wait(400)
    await goToPage(page, left)

    // 8 · Look up a word on Wikipedia
    mark('lookup')
    const lw = await find(page, right, 'telescopes')
    await drag(page, { x: lw.x0 + 1, y: lw.y }, { x: lw.x1 - 1, y: lw.y }, 420)
    await clickAt(page, (lw.x0 + lw.x1) / 2, lw.y, { button: 'right' })
    await wait(350)
    await clickEl(page, page.getByRole('menuitem', { name: 'Look up' }))
    mark('lookup-sent')
    await page.getByText(/Read on Wikipedia/).waitFor({ timeout: 20_000 }).catch(() => undefined)
    mark('lookup-ready')
    await wait(2000)
    await page.keyboard.press('Escape')
    await wait(400)

    // 9 · Pen ink
    const rb = (await page.locator(`[data-page-overlay="${right}"]`).boundingBox())!
    mark('pen', { x: rb.x + rb.width * 0.45, y: rb.y + rb.height * 0.3, w: rb.width * 0.55, h: rb.height * 0.45 })
    await tool(page, 'Pen')
    await wait(300)
    const cx = rb.x + rb.width * 0.72
    const cy = rb.y + rb.height * 0.52
    const loop = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 27) * Math.PI * 2.15 - Math.PI / 2
      return { x: cx + Math.cos(a) * 70, y: cy + Math.sin(a) * 26 }
    })
    await stroke(page, loop, 950)
    await wait(200)
    await stroke(page, [
      { x: rb.x + rb.width * 0.62, y: rb.y + rb.height * 0.62 },
      { x: rb.x + rb.width * 0.75, y: rb.y + rb.height * 0.6 },
      { x: rb.x + rb.width * 0.9, y: rb.y + rb.height * 0.615 }
    ], 520)
    await wait(600)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await wait(400)

    // 10 · Bookmark ribbon
    mark('bookmark')
    await tool(page, 'Bookmark page')
    await wait(1100)
    await page.keyboard.press('Escape')
    await wait(400)

    // 11 · Themes and zoom
    mark('themes')
    await tool(page, 'Display')
    await wait(300)
    const display = page.getByRole('dialog', { name: 'Display' })
    await clickEl(page, display.getByRole('button', { name: 'Sepia' }))
    await wait(1100)
    await clickEl(page, display.getByRole('button', { name: 'Dark' }))
    await wait(1200)
    mark('zoom')
    await clickEl(page, display.getByRole('button', { name: 'Zoom in' }))
    await wait(700)
    await clickEl(page, display.getByRole('button', { name: 'Zoom in' }))
    await wait(900)
    await clickEl(page, display.getByRole('button', { name: 'Zoom out' }))
    await wait(400)
    await clickEl(page, display.getByRole('button', { name: 'Zoom out' }))
    await wait(600)
    await clickEl(page, display.getByRole('button', { name: 'Light' }))
    await wait(700)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await wait(400)

    // 12 · Notebook
    mark('notebook')
    await page.keyboard.press('Control+b')
    await wait(2600)
    mark('end')
    await wait(3000) // let the encoder drain before it is stopped
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'record-failed.png') }).catch(() => undefined)
    throw e
  } finally {
    if (ff) await stopCapture(ff)
    const view = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })).catch(() => null)
    writeFileSync(join(OUT, 'capture.json'), JSON.stringify({ file: CAPTURE, flash: flashT, view, markers }, null, 1))
    console.log(`capture.json: ${markers.length} markers`)
    await r.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
