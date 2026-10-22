import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CSP = "default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:"

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'pageturn-e2e-'))
}

/** Launches the built app (run `electron-vite build` first) with an isolated userData dir. */
export async function launchApp(
  userData: string = makeUserDataDir(),
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  // VS Code terminals export ELECTRON_RUN_AS_NODE=1, which would start Electron as plain Node.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAGETURN_USER_DATA: userData,
    PAGETURN_SKIP_ONBOARDING: '1', // tests start with an empty library unless they opt in
    ...extraEnv
  }
  delete env.ELECTRON_RUN_AS_NODE
  // PAGETURN_APP_PATH runs the suite against a packaged build (e.g. dist/win-unpacked/PageTurn.exe).
  const packaged = process.env.PAGETURN_APP_PATH
  const app = await electron.launch(
    packaged
      ? { executablePath: packaged, args: [], env: env as Record<string, string> }
      : {
          args: [join(__dirname, '..', '..', 'out', 'main', 'index.js')],
          env: env as Record<string, string>
        }
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
