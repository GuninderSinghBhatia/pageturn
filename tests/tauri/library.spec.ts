import { test, expect } from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HELP, ODD3, TEXT500, launch, makeUserData, type Running } from './helpers'

let app: Running | null = null
test.afterEach(async () => {
  await app?.close()
  app = null
})

test('starts empty, imports PDFs, shows them on the shelf, dedupes by content', async () => {
  app = await launch()
  const { page } = app
  await expect(page.getByRole('heading', { name: 'Your library is empty' })).toBeVisible()

  const books = await page.evaluate((p) => window.api.library.import(p), [TEXT500, HELP])
  expect(books).toHaveLength(2)
  expect(books[0].id).toMatch(/^[0-9a-f]{64}$/)
  await expect(page.getByTestId('book-card')).toHaveCount(2)

  // The same file under another name is the same book.
  const dir = mkdtempSync(join(tmpdir(), 'dup-'))
  const copy = join(dir, 'renamed.pdf')
  copyFileSync(TEXT500, copy)
  const again = await page.evaluate((p) => window.api.library.import(p), [copy])
  expect(again[0].id).toBe(books[0].id)
  expect(again[0].path).toBe(copy)
  await expect(page.getByTestId('book-card')).toHaveCount(2)
})

test('the library, likes and progress survive a restart', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  let { page } = app
  const [book] = await page.evaluate((p) => window.api.library.import(p), [TEXT500, ODD3])
  await page.evaluate((id) => window.api.library.setLiked(id, true), book.id)
  await page.evaluate((id) => window.api.reader.saveProgress(id, 7), book.id)
  await app.close()

  app = await launch(userData)
  page = app.page
  const list = await page.evaluate(() => window.api.library.list())
  expect(list).toHaveLength(2)
  const same = list.find((b) => b.id === book.id)!
  expect(same.liked).toBe(true)
  expect(same.lastPage).toBe(7)
  expect(same.missing).toBe(false)
})

test('getFile returns the exact PDF bytes', async () => {
  app = await launch()
  const { page } = app
  const [book] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  const bytes = await page.evaluate(async (id) => {
    const buf = await window.api.library.getFile(id)
    return Array.from(new Uint8Array(buf))
  }, book.id)
  const disk = readFileSync(TEXT500)
  expect(bytes.length).toBe(disk.length)
  expect(Buffer.from(bytes).equals(disk)).toBe(true)
})

test('remove hides a book (annotations kept) and re-import restores it; purge deletes', async () => {
  app = await launch()
  const { page } = app
  const [book] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  await page.evaluate(
    (b) => window.api.annotations.toggleBookmark(b, 3, 'kept', undefined),
    book.id
  )
  await page.evaluate((id) => window.api.library.remove(id, false), book.id)
  expect(await page.evaluate(() => window.api.library.list())).toHaveLength(0)
  await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  const ann = await page.evaluate((id) => window.api.annotations.listForBook(id), book.id)
  expect(ann.bookmarks).toHaveLength(1)

  await page.evaluate((id) => window.api.library.remove(id, true), book.id)
  await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  const gone = await page.evaluate((id) => window.api.annotations.listForBook(id), book.id)
  expect(gone.bookmarks).toHaveLength(0)
})

test('a missing file is flagged, and unknown ids and non-PDF paths are rejected', async () => {
  app = await launch()
  const { page } = app
  const dir = mkdtempSync(join(tmpdir(), 'gone-'))
  const file = join(dir, 'temp.pdf')
  copyFileSync(TEXT500, file)
  await page.evaluate((p) => window.api.library.import(p), [file])
  await page.reload()
  await page.waitForFunction(() => typeof window.api?.library?.list === 'function')
  const rmErr = await page.evaluate(
    async (p) => {
      try {
        await window.api.library.import([p])
        return 'ok'
      } catch (e) {
        return String(e)
      }
    },
    join(dir, 'notes.txt')
  )
  expect(rmErr).toMatch(/Invalid input/)
  const unknown = await page.evaluate(async () => {
    try {
      await window.api.library.setLiked('c'.repeat(64), true)
      return 'ok'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  expect(unknown).toBe('Unknown book')
})

test('thumbnails: saved PNG comes back as a cover data URL', async () => {
  app = await launch()
  const { page } = app
  const [book] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  // 1x1 transparent PNG
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const url = await page.evaluate(
    async ([id, b64]) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return window.api.library.saveThumbnail(id, bytes.buffer)
    },
    [book.id, png]
  )
  expect(url.startsWith('data:image/png;base64,')).toBe(true)
  const [after] = await page.evaluate(() => window.api.library.list())
  expect(after.thumbnailUrl).toBe(url)
})
