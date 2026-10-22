import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import electronPath from 'electron'
import { FIXTURES } from './annotationHelpers'
import { launchApp, makeUserDataDir } from './helpers'

test('opening a PDF while PageTurn runs hands it to the open window (no second instance)', async () => {
  test.setTimeout(60_000)
  const userData = makeUserDataDir()
  const { app, page } = await launchApp(userData)
  try {
    await expect(page.getByRole('tab', { name: 'Books' })).toBeVisible()
    const env: Record<string, string | undefined> = {
      ...process.env,
      PAGETURN_USER_DATA: userData,
      PAGETURN_SKIP_ONBOARDING: '1'
    }
    delete env.ELECTRON_RUN_AS_NODE
    const started = Date.now()
    const second = spawn(
      electronPath as unknown as string,
      [join(__dirname, '..', '..', 'out', 'main', 'index.js'), join(FIXTURES, 'odd-3.pdf')],
      { env: env as NodeJS.ProcessEnv, stdio: 'ignore' }
    )
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve))
    expect(Date.now() - started).toBeLessThan(3000 + 2000) // exits promptly (allowing for start-up)
    expect(code).toBe(0)

    await expect(page.getByTestId('book-stage')).toBeVisible()
    const opened = await page.evaluate(async () =>
      (await window.api.library.list()).map((b) => b.title)
    )
    expect(opened).toEqual(['Text 3'])
  } finally {
    await app.close()
  }
})
