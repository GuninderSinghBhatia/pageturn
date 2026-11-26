import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeUserData, TEXT500 } from '../tauri/helpers'

/**
 * Start-up time and memory of the Tauri release build (`npm run tauri:build` first).
 * Not part of the regular suites. Run: npx playwright test -c playwright.measure.config.ts
 *
 * The 1.x build's numbers, taken with this same harness, are in
 * docs/superpowers/specs/2026-11-25-tauri-migration.md. "Memory" sums the app process and every
 * child it started (WebView2's helper processes), as working set and as private bytes.
 */

const ROOT = join(__dirname, '..', '..')
const TAURI_EXE = join(ROOT, 'src-tauri', 'target', 'release', 'pageturn.exe')
const RUNS = 3

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Memory of a process tree in MB: [workingSet, privateBytes]. */
function treeMemory(rootPid: number): [number, number] {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `
    $all = Get-CimInstance Win32_Process
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add(${rootPid})
    do { $n = $ids.Count
      foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
    } while ($ids.Count -ne $n)
    $ws = 0; $pv = 0
    foreach ($id in $ids) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $ws += $q.WorkingSet64; $pv += $q.PrivateMemorySize64 } }
    "$([math]::Round($ws/1MB,1)) $([math]::Round($pv/1MB,1)) $($ids.Count)"`
    ],
    { encoding: 'utf8' }
  )
    .trim()
    .split(' ')
  return [Number(out[0]), Number(out[1])]
}

type Sample = {
  home: number
  book: number
  wsHome: number
  pvHome: number
  wsBook: number
}

async function measureTauri(): Promise<Sample> {
  const userData = makeUserData()
  const t0 = Date.now()
  const app = await launch(userData, {
    exe: TAURI_EXE,
    urlIncludes: 'tauri.localhost',
    env: { PAGETURN_UPDATE_URL: 'http://127.0.0.1:9/latest.json' }
  })
  try {
    const { page } = app
    await page.getByRole('tab').first().waitFor()
    const home = Date.now() - t0
    const pid = app.proc.pid!
    await page.waitForTimeout(4000)
    const [wsHome, pvHome] = treeMemory(pid)
    await page.evaluate((p) => window.api.library.import([p]), TEXT500)
    const t1 = Date.now()
    await page.getByTestId('book-card').getByRole('button').first().click()
    await expect(page.getByTestId('book-stage')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000
    })
    const book = Date.now() - t1
    await page.waitForTimeout(3000)
    const [wsBook] = treeMemory(pid)
    return { home, book, wsHome, pvHome, wsBook }
  } finally {
    await app.close()
  }
}

test('start-up time and memory', async () => {
  test.setTimeout(600_000)
  test.skip(!existsSync(TAURI_EXE), 'build the release app first (npm run tauri:build)')
  const results: Record<string, Sample[]> = { tauri: [] }
  for (let i = 0; i < RUNS; i++) results.tauri.push(await measureTauri())
  const rows = Object.entries(results).map(([name, s]) => ({
    app: name,
    'home ready (ms)': median(s.map((x) => x.home)),
    'book open (ms)': median(s.map((x) => x.book)),
    'RAM home, working set (MB)': median(s.map((x) => x.wsHome)),
    'RAM home, private (MB)': median(s.map((x) => x.pvHome)),
    'RAM book open, working set (MB)': median(s.map((x) => x.wsBook))
  }))
  console.log('\nMEASURE ' + JSON.stringify({ runs: RUNS, rows, raw: results }, null, 1))
})
