import { test, expect } from '@playwright/test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makeUserData, TEXT500, type Running } from '../tauri/helpers'

/**
 * Installer and signed-update tests. They install the TEST identity ("PageTurn Test") built by
 * `npm run tauri:test:installers:build` into a temp folder, so a real PageTurn is never touched.
 * Run with: npx playwright test -c playwright.installer.config.ts
 */

const BUILDS = join(__dirname, '..', '..', 'out', 'installer-test')
const NAME = 'PageTurn Test'
const PORT = 9411
const FEED_PORT = 8765

const setupOf = (v: string): string => {
  const dir = join(BUILDS, v)
  const f = readdirSync(dir).find((x) => x.endsWith('-setup.exe'))
  if (!f) throw new Error(`No installer in ${dir}`)
  return join(dir, f)
}

const run = (script: string): string =>
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  }).trim()

/** Uninstall-registry entries whose display name matches. */
function uninstallEntries(pattern: string): string[] {
  const out = run(`
    $r = foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall') {
      Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.DisplayName -like '${pattern}') { "$($_.PSChildName)|$($p.DisplayName)|$($p.DisplayVersion)" } }
    }
    $r -join "\`n"`)
  return out ? out.split('\n').map((s) => s.trim()) : []
}

/** The 8.3 form of a path, which has no spaces. */
function shortPath(dir: string): string {
  const short = run(
    `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir.replace(/'/g, "''")}').ShortPath`
  )
  return short && !short.includes(' ') ? short : dir
}

const startMenu = (): string =>
  join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')

/** A fingerprint of a real PageTurn installation, to prove the tests leave it alone. */
function realInstallFingerprint(): string {
  const dir = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'PageTurn')
  const files = existsSync(dir)
    ? readdirSync(dir).map((f) => `${f}:${statSync(join(dir, f)).size}`)
    : ['(none)']
  const lnk = join(startMenu(), 'PageTurn.lnk')
  return JSON.stringify({
    entries: uninstallEntries('PageTurn').filter((e) => !e.includes(NAME)),
    files,
    shortcut: existsSync(lnk) ? statSync(lnk).mtimeMs : null
  })
}

function sign(file: string, keyFile: string, password: string): string {
  execFileSync('npx.cmd', ['tauri', 'signer', 'sign', '-f', keyFile, '-p', password, file], {
    cwd: join(__dirname, '..', '..'),
    stdio: 'ignore',
    shell: true
  })
  return readFileSync(`${file}.sig`, 'utf8').trim()
}

type Feed = { version: string; file: string; signature: string } | null

let installDir = ''
let userData = ''
let server: Server
let feed: Feed = null
let app: Running | null = null
let before = ''

function exeIn(dir: string): string {
  const f = readdirSync(dir).find((x) => x.endsWith('.exe') && !/^uninstall/i.test(x))
  if (!f) throw new Error(`No application exe in ${dir}`)
  return join(dir, f)
}

async function launchInstalled(): Promise<Running> {
  return launch(userData, {
    exe: exeIn(installDir),
    urlIncludes: 'tauri.localhost',
    port: PORT,
    env: { PAGETURN_UPDATE_URL: `http://127.0.0.1:${FEED_PORT}/latest.json` }
  })
}

async function attachWhenUp(timeoutMs: number): Promise<{ browser: Browser; page: Page }> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
      const page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes('tauri.localhost'))
      if (page) {
        await page.waitForFunction(() => typeof window.api?.app?.version === 'function')
        return { browser, page }
      }
      await browser.close()
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('The relaunched app did not come up')
}

const killInstalled = (): void => {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-Process | Where-Object { $_.Path -like '${installDir.replace(/'/g, "''")}*' } | Stop-Process -Force`
      ],
      { stdio: 'ignore' }
    )
  } catch {
    /* nothing running */
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  // NSIS reads /D= literally, so the path must not contain spaces (Node would quote them).
  installDir = join(shortPath(mkdtempSync(join(tmpdir(), 'pt-install-'))), 'app')
  userData = makeUserData()
  before = realInstallFingerprint()
  server = createServer((req, res) => {
    if (req.url === '/latest.json' && feed) {
      const base = `http://127.0.0.1:${FEED_PORT}`
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          version: feed.version,
          notes: 'test',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              signature: feed.signature,
              url: `${base}/download/${encodeURIComponent('update-setup.exe')}`
            }
          }
        })
      )
    } else if (req.url?.startsWith('/download/') && feed) {
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', statSync(feed.file).size)
      createReadStream(feed.file).pipe(res)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(FEED_PORT, '127.0.0.1', r))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  killInstalled()
  server?.close()
  // Leave nothing behind, even if a test failed half-way. `_?=` makes the uninstaller run in
  // place and wait, instead of copying itself away and returning at once.
  const un = join(installDir, 'uninstall.exe')
  if (existsSync(un)) {
    try {
      execFileSync(un, ['/S', `_?=${installDir}`], { stdio: 'ignore', timeout: 60_000 })
    } catch {
      /* best effort */
    }
  }
})

test('1. silent install: files, uninstaller, registry entry and shortcut; a real install is untouched', async () => {
  test.setTimeout(180_000)
  expect(uninstallEntries(`${NAME}*`)).toEqual([])
  // /D= must be last and unquoted (NSIS).
  expect(installDir).not.toContain(' ')
  execFileSync(setupOf('1.0.1'), ['/S', `/D=${installDir}`], { timeout: 150_000 })
  await expect
    .poll(() => existsSync(join(installDir, 'uninstall.exe')), { timeout: 60_000 })
    .toBe(true)
  const exe = exeIn(installDir)
  expect(statSync(exe).size).toBeGreaterThan(1_000_000)
  expect(statSync(exe).size).toBeLessThan(40_000_000) // no browser bundled

  const entries = uninstallEntries(`${NAME}*`)
  expect(entries.length).toBe(1)
  expect(entries[0]).toContain('1.0.1')
  expect(existsSync(join(startMenu(), `${NAME}.lnk`))).toBe(true)

  expect(realInstallFingerprint()).toBe(before)
})

test('2. the installed app starts, works and reports 1.0.1; no update is offered for the same version', async () => {
  app = await launchInstalled()
  const { page } = app
  expect(await page.evaluate(() => window.api.app.version())).toBe('1.0.1')
  await expect(page.getByRole('tab')).toHaveText(['Books', 'Notes', 'Search Online', 'Settings'])
  const [book] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  await expect(page.getByTestId('book-card')).toHaveCount(1)

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).not.toContain('unsafe-inline')

  // The app is a release build, so updates are on: the feed says "same version".
  feed = { version: '1.0.1', file: setupOf('1.0.1'), signature: 'unused' }
  expect(await page.evaluate(() => window.api.app.checkForUpdates())).toEqual({
    status: 'current'
  })
  expect(book.id).toMatch(/^[0-9a-f]{64}$/)
})

test('3. a tampered update is refused: wrong signing key, and a modified installer', async () => {
  test.setTimeout(180_000)
  const { page } = app!
  const dir = mkdtempSync(join(tmpdir(), 'tamper-'))
  const real = setupOf('1.0.2')

  // (a) A genuine 1.0.2 installer signed by SOMEONE ELSE'S key.
  const evilKey = join(dir, 'evil.key')
  execFileSync(
    'npx.cmd',
    ['tauri', 'signer', 'generate', '-w', evilKey, '-p', 'evil-pass', '--ci'],
    { cwd: join(__dirname, '..', '..'), stdio: 'ignore', shell: true }
  )
  const forged = join(dir, 'forged-setup.exe')
  copyFileSync(real, forged)
  const forgedSig = sign(forged, evilKey, 'evil-pass')
  feed = { version: '1.0.2', file: forged, signature: forgedSig }

  const events = await page.evaluate(async () => {
    const seen: string[] = []
    window.api.app.onUpdateAvailable((e) => seen.push('available:' + e.version))
    window.api.app.onUpdateDownloaded((e) => seen.push('downloaded:' + e.version))
    await new Promise((r) => setTimeout(r, 500))
    const status = await window.api.app.checkForUpdates()
    await new Promise((r) => setTimeout(r, 12_000))
    return { status, seen }
  })
  expect(events.status).toMatchObject({ status: 'available', version: '1.0.2' })
  expect(events.seen).not.toContain('downloaded:1.0.2')
  const refused = await page.evaluate(async () => {
    try {
      await window.api.app.installUpdate()
      return 'installed?!'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  expect(refused).toMatch(/No update has been downloaded/)
  expect(await page.evaluate(() => window.api.app.version())).toBe('1.0.1')

  // (b) The genuine signature, but the installer bytes were changed after signing.
  const modified = join(dir, 'modified-setup.exe')
  const bytes = readFileSync(real)
  writeFileSync(modified, Buffer.concat([bytes, Buffer.from('tampered')]))
  feed = {
    version: '1.0.3',
    file: modified,
    signature: readFileSync(`${real}.sig`, 'utf8').trim()
  }
  const second = await page.evaluate(async () => {
    const seen: string[] = []
    window.api.app.onUpdateDownloaded((e) => seen.push('downloaded:' + e.version))
    await new Promise((r) => setTimeout(r, 500))
    await window.api.app.checkForUpdates()
    await new Promise((r) => setTimeout(r, 10_000))
    return seen
  })
  expect(second).not.toContain('downloaded:1.0.3')
  expect(await page.evaluate(() => window.api.app.version())).toBe('1.0.1')
})

test('4. a correctly signed update downloads, installs, restarts into 1.0.2 and keeps the library', async () => {
  test.setTimeout(300_000)
  const { page } = app!
  feed = {
    version: '1.0.2',
    file: setupOf('1.0.2'),
    signature: readFileSync(`${setupOf('1.0.2')}.sig`, 'utf8').trim()
  }
  const before = await page.evaluate(() => window.api.library.list())
  expect(before).toHaveLength(1)

  const status = await page.evaluate(async () => {
    ;(window as unknown as { __dl: string[] }).__dl = []
    window.api.app.onUpdateDownloaded((e) =>
      (window as unknown as { __dl: string[] }).__dl.push(e.version)
    )
    await new Promise((r) => setTimeout(r, 500))
    return window.api.app.checkForUpdates()
  })
  expect(status).toMatchObject({ status: 'available', version: '1.0.2' })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dl: string[] }).__dl), {
      timeout: 60_000
    })
    .toContain('1.0.2')

  // Install: the app quits, the installer runs, and the new version starts.
  await page.evaluate(() => void window.api.app.installUpdate().catch(() => undefined))
  await app!.browser.close().catch(() => undefined)
  await new Promise((r) => setTimeout(r, 8_000))

  let relaunched: { browser: Browser; page: Page }
  try {
    relaunched = await attachWhenUp(60_000) // started by the installer itself
  } catch {
    const again = await launchInstalled() // or by us, if the installer does not restart it
    relaunched = { browser: again.browser, page: again.page }
    app = again
  }
  const p = relaunched.page
  await expect
    .poll(() => p.evaluate(() => window.api.app.version()), { timeout: 30_000 })
    .toBe('1.0.2')
  const after = await p.evaluate(() => window.api.library.list())
  expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id))
  expect(uninstallEntries(`${NAME}*`)[0]).toContain('1.0.2')
  await relaunched.browser.close().catch(() => undefined)
})

test('5. uninstall removes the program, shortcut and registry entry but keeps the library', async () => {
  test.setTimeout(120_000)
  await app?.close().catch(() => undefined)
  killInstalled()
  await new Promise((r) => setTimeout(r, 1500))
  const exe = exeIn(installDir)
  const un = join(installDir, 'uninstall.exe')
  expect(existsSync(un)).toBe(true)

  // `_?=` makes the uninstaller run in place and wait, instead of copying itself and returning.
  const child = spawn(un, ['/S', `_?=${installDir}`], { stdio: 'ignore' })
  await new Promise<void>((res) => child.once('exit', () => res()))
  await expect.poll(() => existsSync(exe), { timeout: 60_000 }).toBe(false)
  expect(uninstallEntries(`${NAME}*`)).toEqual([])
  expect(existsSync(join(startMenu(), `${NAME}.lnk`))).toBe(false)
  expect(existsSync(join(userData, 'pageturn.db'))).toBe(true) // the reader's data is not deleted
  expect(realInstallFingerprint()).toBe(before)
  expect(homedir()).toBeTruthy()
})
