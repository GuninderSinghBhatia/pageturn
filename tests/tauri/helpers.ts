import { chromium, type Browser, type Page } from '@playwright/test'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Drives the real Tauri app: the debug binary talking to the Vite dev server, with its
 * WebView2 window opened for remote debugging so Playwright can attach over CDP.
 * Needs `cargo build --no-default-features` in src-tauri first (see `npm run tauri:test`).
 * Every launch gets an isolated data folder, so a real library is never touched.
 */

export const EXE = join(__dirname, '..', '..', 'src-tauri', 'target', 'debug', 'pageturn.exe')
export const FIXTURES = join(__dirname, '..', 'fixtures')
export const TEXT500 = join(FIXTURES, 'text-500.pdf')
export const TEXT1000 = join(FIXTURES, 'text-1000.pdf')
export const HELP = join(FIXTURES, 'help.pdf')
export const ODD3 = join(FIXTURES, 'odd-3.pdf')

let nextPort = 9300

export type Running = {
  proc: ChildProcess
  browser: Browser
  page: Page
  userData: string
  close(): Promise<void>
}

export function makeUserData(): string {
  return mkdtempSync(join(tmpdir(), 'pageturn-tauri-'))
}

async function waitForCdp(port: number, ms = 40_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`WebView2 debugging port ${port} did not open`)
}

/** Starts the app. `args` are command-line arguments (e.g. a PDF path for "Open with"). */
export async function launch(
  userData: string = makeUserData(),
  opts: {
    env?: Record<string, string>
    args?: string[]
    /** Another build of the app (an installed copy); defaults to the debug binary. */
    exe?: string
    /** Part of the page URL that identifies the app's page (dev server vs. installed copy). */
    urlIncludes?: string
    /** Fixed debugging port (when the app relaunches itself, e.g. after an update). */
    port?: number
  } = {}
): Promise<Running> {
  const port = opts.port ?? nextPort++
  const webview = join(userData, 'webview')
  mkdirSync(webview, { recursive: true })
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAGETURN_USER_DATA: userData,
    PAGETURN_SKIP_ONBOARDING: '1',
    WEBVIEW2_USER_DATA_FOLDER: webview,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    ...opts.env
  }
  const proc = spawn(opts.exe ?? EXE, opts.args ?? [], {
    env: env as NodeJS.ProcessEnv,
    stdio: 'ignore'
  })
  await waitForCdp(port)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const deadline = Date.now() + 30_000
  let page: Page | undefined
  while (!page && Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes(opts.urlIncludes ?? 'localhost:5174'))
    if (!page) await new Promise((r) => setTimeout(r, 250))
  }
  if (!page) throw new Error('The PageTurn page did not load (is the Vite server on :5174 up?)')
  await page.waitForFunction(() => typeof window.api?.library?.list === 'function')
  return {
    proc,
    browser,
    page,
    userData,
    close: async () => {
      await browser.close().catch(() => undefined)
      if (proc.pid) {
        try {
          execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
        } catch {
          /* already gone */
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

/** Waits until the process behind `r` has exited. */
export async function waitExit(r: Running, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (r.proc.exitCode !== null) return true
    await new Promise((x) => setTimeout(x, 200))
  }
  return false
}
