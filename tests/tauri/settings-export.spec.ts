import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEXT500, launch, makeUserData, type Running } from './helpers'

let app: Running | null = null
test.afterEach(async () => {
  await app?.close()
  app = null
})

test('settings: defaults, partial update, persistence, validation', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  let page = app.page
  const defaults = await page.evaluate(() => window.api.settings.get())
  expect(defaults.theme).toBeDefined()
  expect(typeof defaults.helpPanelWidth).toBe('number')

  const updated = await page.evaluate(() =>
    window.api.settings.set({ theme: 'dark', pageTurnStyle: 'slide', helpPanelWidth: 500 })
  )
  expect(updated).toMatchObject({ theme: 'dark', pageTurnStyle: 'slide', helpPanelWidth: 500 })
  // The theme is applied when the UI loads its settings.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const bad = await page.evaluate(async () => {
    try {
      await window.api.settings.set({ helpPanelWidth: 5 })
      return 'ok'
    } catch (e) {
      return String(e)
    }
  })
  expect(bad).not.toBe('ok')

  await app.close()
  app = await launch(userData)
  page = app.page
  const again = await page.evaluate(() => window.api.settings.get())
  expect(again).toMatchObject({ theme: 'dark', pageTurnStyle: 'slide', helpPanelWidth: 500 })
})

test('API keys: stored encrypted, only a boolean comes back, survive a restart, can be cleared', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  let page = app.page
  expect(await page.evaluate(() => window.api.settings.hasApiKey('openai'))).toBe(false)
  await page.evaluate(() => window.api.settings.setApiKey('openai', 'sk-test-SECRET-123456'))
  expect(await page.evaluate(() => window.api.settings.hasApiKey('openai'))).toBe(true)
  expect(await page.evaluate(() => window.api.settings.hasApiKey('anthropic'))).toBe(false)

  const all = JSON.stringify(await page.evaluate(() => window.api.settings.get()))
  expect(all).not.toContain('SECRET')
  const secrets = join(userData, 'secrets.bin')
  expect(existsSync(secrets)).toBe(true)
  expect(readFileSync(secrets, 'utf8')).not.toContain('SECRET')

  await app.close()
  app = await launch(userData)
  page = app.page
  expect(await page.evaluate(() => window.api.settings.hasApiKey('openai'))).toBe(true)
  await page.evaluate(() => window.api.settings.clearApiKey('openai'))
  expect(await page.evaluate(() => window.api.settings.hasApiKey('openai'))).toBe(false)
})

test('Markdown export contains the note, its quote and bookmarks', async () => {
  app = await launch()
  const { page } = app
  const [b] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  await page.evaluate(async (bookId) => {
    const now = Date.now()
    const hid = crypto.randomUUID()
    const nid = crypto.randomUUID()
    await window.api.annotations.upsertHighlight({
      id: hid,
      bookId,
      page: 3,
      rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
      text: 'an important sentence',
      color: 'yellow',
      style: 'note',
      noteId: nid,
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.upsertNote({
      id: nid,
      bookId,
      page: 3,
      anchor: { highlightId: hid },
      body: 'why it matters',
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.toggleBookmark(bookId, 7, 'revisit', undefined)
  }, b.id)
  const md = await page.evaluate((id) => window.api.export.markdownText(id), b.id)
  expect(md).toContain('an important sentence')
  expect(md).toContain('why it matters')
  expect(md).toContain('revisit')
})

test('backup file imports into a fresh install (round trip), and re-importing adds nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-'))
  const file = join(dir, 'backup.json')

  app = await launch(undefined, { env: { PAGETURN_SAVE_PATH: file } })
  let page = app.page
  const [b] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  await page.evaluate(async (bookId) => {
    const now = Date.now()
    await window.api.annotations.upsertNote({
      id: crypto.randomUUID(),
      bookId,
      page: 1,
      anchor: { point: { x: 0.2, y: 0.2 } },
      body: 'travels in the backup',
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.addInk([
      {
        id: crypto.randomUUID(),
        bookId,
        page: 2,
        points: [
          [0.1, 0.1, 0.5],
          [0.2, 0.2, 0.5]
        ],
        color: '#1f1f1f',
        width: 0.005,
        tool: 'pen',
        createdAt: now
      }
    ])
  }, b.id)
  const saved = await page.evaluate(() => window.api.export.backup())
  expect(saved.saved).toBe(true)
  expect(existsSync(file)).toBe(true)
  const json = JSON.parse(readFileSync(file, 'utf8'))
  expect(JSON.stringify(json)).not.toMatch(/api.?key/i)
  await app.close()

  app = await launch(undefined, { env: { PAGETURN_OPEN_PATH: file } })
  page = app.page
  const first = await page.evaluate(() => window.api.export.importBackup())
  expect('error' in first).toBe(false)
  const list = await page.evaluate(() => window.api.library.list())
  expect(list.map((x) => x.id)).toContain(b.id)
  const a = await page.evaluate((id) => window.api.annotations.listForBook(id), b.id)
  expect(a.notes.map((n) => n.body)).toContain('travels in the backup')
  expect(a.ink).toHaveLength(1)
  const second = await page.evaluate(() => window.api.export.importBackup())
  expect('added' in second && second.added).toBe(0)
})

test('a file that is not a backup is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notbackup-'))
  const file = join(dir, 'x.json')
  writeFileSync(file, JSON.stringify({ hello: 'world' }))
  app = await launch(undefined, { env: { PAGETURN_OPEN_PATH: file } })
  const r = await app.page.evaluate(() => window.api.export.importBackup())
  expect('error' in r).toBe(true)
})
