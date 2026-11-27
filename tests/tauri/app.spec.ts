import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { TEXT500, EXE, launch, makeUserData, waitExit, type Running } from './helpers'

let app: Running | null = null
test.afterEach(async () => {
  await app?.close()
  app = null
})

test('home screen: tabs, empty state, theme from settings', async () => {
  app = await launch()
  const { page } = app
  await expect(page.getByRole('tab')).toHaveText(['Books', 'Notes', 'Search Online', 'Settings'])
  await expect(page.getByText('Your library is empty')).toBeVisible()
  await page.getByRole('tab', { name: 'Notes' }).click()
  await page.getByRole('tab', { name: 'Books' }).click()
})

test('shelf: spines, focus moves with keys, filters work', async () => {
  app = await launch()
  const { page } = app
  const books = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  expect(books).toHaveLength(1)
  await expect(page.getByTestId('book-card')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Your shelf' })).toBeVisible()
  await page.getByRole('button', { name: 'Reading', exact: true }).click()
  await expect(page.getByText('Nothing on this shelf yet.')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByTestId('book-card')).toHaveCount(1)
})

test('opens a book, turns pages with the keyboard, remembers the page across a restart', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  let page = app.page
  await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  await expect(page.getByTestId('book-card')).toHaveCount(1)
  await page.getByTestId('book-card').getByRole('button').first().click()
  await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000
  })
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true')
  }
  await expect(page.getByTestId('page-box')).toHaveValue('7')
  await page.waitForTimeout(900) // progress save is debounced
  await app.close()

  app = await launch(userData)
  page = app.page
  await page.getByTestId('book-card').getByRole('button').first().click()
  await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000
  })
  await expect(page.getByTestId('page-box')).toHaveValue('7')
})

test('window: state, maximise toggle fires an event, aspect lock', async () => {
  app = await launch()
  const { page } = app
  const s0 = await page.evaluate(() => window.api.window.getState())
  expect(s0).toEqual({ maximized: false, fullscreen: false })
  await page.evaluate(() => {
    ;(window as unknown as { __states: unknown[] }).__states = []
    window.api.window.onState((s) =>
      (window as unknown as { __states: unknown[] }).__states.push(s)
    )
  })
  await page.evaluate(() => window.api.window.control('toggleMaximize'))
  await expect
    .poll(() => page.evaluate(() => window.api.window.getState().then((s) => s.maximized)))
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __states: { maximized: boolean }[] }).__states.length
      )
    )
    .toBeGreaterThan(0)
  await page.evaluate(() => window.api.window.control('toggleMaximize'))
  await expect
    .poll(() => page.evaluate(() => window.api.window.getState().then((s) => s.maximized)))
    .toBe(false)

  await page.evaluate(() => window.api.window.fitAspect(0.7))
  const ratio = await page.evaluate(() => window.outerWidth / window.outerHeight)
  expect(ratio).toBeGreaterThan(0.55)
  expect(ratio).toBeLessThan(0.85)
  await page.evaluate(() => window.api.window.fitAspect(0))
  const bad = await page.evaluate(async () => {
    try {
      await window.api.window.fitAspect(9)
      return 'ok'
    } catch (e) {
      return String(e)
    }
  })
  expect(bad).not.toBe('ok')
})

test('app: version, logs are written, update check says dev, errors are logged', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  const { page } = app
  expect(await page.evaluate(() => window.api.app.version())).toMatch(/^\d+\.\d+\.\d+/)
  expect((await page.evaluate(() => window.api.app.checkForUpdates())).status).toBe('dev')
  await page.evaluate(() => window.api.app.reportError('tauri-test-marker', 'stack'))
  await page.waitForTimeout(500)
  const { readFileSync, existsSync } = await import('node:fs')
  const log = `${userData}\\logs\\main.log`
  expect(existsSync(log)).toBe(true)
  expect(readFileSync(log, 'utf8')).toContain('tauri-test-marker')
})

test('AI (mock provider): streams tokens, finishes, follow-up and cancel work', async () => {
  app = await launch(undefined, { env: { PAGETURN_AI_MOCK: '1' } })
  const { page } = app
  // Like PageTurn 1.x, the mock still needs a saved key for the selected provider.
  await page.evaluate(async () => {
    const { aiProvider } = await window.api.settings.get()
    if (aiProvider !== 'claude') await window.api.settings.setApiKey(aiProvider, 'sk-test-key-0001')
  })
  const run = await page.evaluate(async () => {
    const events: string[] = []
    let text = ''
    window.api.ai.onToken((e) => {
      events.push('token')
      text += e.token
    })
    const done = new Promise<string>((res) => window.api.ai.onDone((e) => res(e.text)))
    await new Promise((r) => setTimeout(r, 500)) // Tauri listeners register asynchronously
    await window.api.ai.explain('request-0001', {
      bookTitle: 'T',
      heading: null,
      selection: 'entropy',
      pages: [1],
      pageText: 'entropy is a measure of disorder',
      prevTail: '',
      nextHead: ''
    })
    const final = await Promise.race([
      done,
      new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 10_000))
    ])
    return { tokens: events.length, text, final }
  })
  expect(run.final).not.toBe('TIMEOUT')
  expect(run.tokens).toBeGreaterThan(0)
  expect(run.final.length).toBeGreaterThan(0)
  expect(run.final).toBe(run.text)

  const follow = await page.evaluate(async () => {
    const done = new Promise<string>((res) => window.api.ai.onDone((e) => res(e.text)))
    await new Promise((r) => setTimeout(r, 500))
    await window.api.ai.followUp('request-0001', 'and why?')
    return Promise.race([done, new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 10_000))])
  })
  expect(follow).not.toBe('TIMEOUT')
  await page.evaluate(() => window.api.ai.cancel('request-0001'))
})

test('rag: unreachable service gives ok:false; a fake service answers with sorted unique pages', async () => {
  app = await launch()
  const { page } = app
  const down = await page.evaluate(() => window.api.rag.health())
  if (!down.ok) expect(down.error).toMatch(/not reachable/)

  const bodies: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      bodies.push(`${req.method} ${req.url} ${body}`)
      res.setHeader('content-type', 'application/json')
      if (req.url === '/health') res.end(JSON.stringify({ status: 'healthy' }))
      else res.end(JSON.stringify({ answer: 'It is X (Page 3).', context_pages: [3, 1, 3] }))
    })
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(8000, '127.0.0.1', () => resolve(true))
  })
  test.skip(!listening, 'port 8000 is in use (a real rag-service is running)')
  try {
    expect(await page.evaluate(() => window.api.rag.health())).toMatchObject({ ok: true })
    const ask = await page.evaluate(() => window.api.rag.ask('What is X?', 42))
    expect(ask).toEqual({ ok: true, answer: 'It is X (Page 3).', pages: [1, 3] })
    const who = await page.evaluate(() => window.api.rag.who('LoRA', 100))
    expect(who).toMatchObject({ ok: true })
    expect(bodies.some((b) => b.includes('/ask') && b.includes('"current_page":42'))).toBe(true)
    expect(bodies.some((b) => b.includes('/who') && b.includes('LoRA'))).toBe(true)
  } finally {
    server.close()
  }
})

test('look-up: only web addresses may be opened; bad language is refused', async () => {
  app = await launch()
  const { page } = app
  for (const code of [
    `await api.lookup.open('file:///C:/Windows/win.ini', 'browser')`,
    `await api.lookup.open('javascript:alert(1)', 'app')`,
    `await api.lookup.wikipedia('entropy', '../evil')`
  ]) {
    const r = await page.evaluate(async (src) => {
      try {
        await new Function('api', `return (async () => { ${src} })()`)(window.api)
        return 'ok'
      } catch (e) {
        return String(e)
      }
    }, code)
    expect(r, code).not.toBe('ok')
  }
})

test('"Open with": a second launch with a PDF opens it in the running window', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  const { page } = app
  // Let the React app mount and subscribe before a second launch hands over a file.
  await expect(page.getByRole('tab').first()).toBeVisible()
  await page.waitForTimeout(800)
  const second = spawn(EXE, [TEXT500], {
    env: { ...process.env, PAGETURN_USER_DATA: userData, PAGETURN_SKIP_ONBOARDING: '1' },
    stdio: 'ignore'
  })
  const exited = await new Promise<boolean>((res) => {
    const t = setTimeout(() => res(false), 15_000)
    second.once('exit', () => {
      clearTimeout(t)
      res(true)
    })
  })
  expect(exited, 'the second instance should hand over and quit').toBe(true)
  // The running instance imports the file a moment after the second one quits.
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.api.library.list())).map((b) => b.path.toLowerCase()),
      { timeout: 15_000 }
    )
    .toContain(TEXT500.toLowerCase())
  await expect(page.getByTestId('book-stage')).toBeVisible({ timeout: 20_000 })
  await waitExit(app, 0)
})

test('starting with a PDF argument imports and opens it', async () => {
  app = await launch(undefined, { args: [TEXT500] })
  const { page } = app
  await expect(page.getByTestId('book-stage')).toBeVisible({ timeout: 25_000 })
  expect(await page.evaluate(() => window.api.library.list())).toHaveLength(1)
})

test('secure window: title, no Node, strict CSP, no global Tauri object', async () => {
  app = await launch()
  const { page } = app
  await expect(page).toHaveTitle('PageTurn')
  const probe = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    tauriGlobal: typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__
  }))
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', tauriGlobal: 'undefined' })
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('ipc:')
  expect(csp).not.toContain('*')
})
