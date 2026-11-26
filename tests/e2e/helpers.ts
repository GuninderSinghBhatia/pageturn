import type { Browser, Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, visibleWindows } from '../tauri/helpers'

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'pageturn-e2e-'))
}

/**
 * Launches the Tauri debug app (`npm run tauri:build:debug` first) with an isolated data folder
 * and attaches Playwright to its WebView2 page over CDP (see tests/tauri/helpers.ts).
 */
export async function launchApp(
  userData: string = makeUserDataDir(),
  extraEnv: Record<string, string> = {}
): Promise<{
  app: { close(): Promise<void>; visibleWindows(): number }
  page: Page
  browser: Browser
}> {
  const r = await launch(userData, { env: extraEnv })
  const app = { close: r.close, visibleWindows: () => visibleWindows(r.proc.pid!) }
  return { app, page: r.page, browser: r.browser }
}
