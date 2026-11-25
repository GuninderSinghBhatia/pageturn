import { test, expect, type Page } from '@playwright/test'
import { TEXT500, launch, makeUserData, type Running } from './helpers'

let app: Running | null = null
test.afterEach(async () => {
  await app?.close()
  app = null
})

/** Imports the book and returns its id. */
async function book(page: Page): Promise<string> {
  const [b] = await page.evaluate((p) => window.api.library.import(p), [TEXT500])
  return b.id
}

/** Runs `fn` in the page and returns its error message, or 'ok'. */
async function errorOf(page: Page, fn: string): Promise<string> {
  return page.evaluate(async (src) => {
    try {
      await new Function('api', `return (async () => { ${src} })()`)(window.api)
      return 'ok'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, fn)
}

test('highlights, notes, ink and bookmarks round-trip and survive a restart', async () => {
  const userData = makeUserData()
  app = await launch(userData)
  let page = app.page
  const bookId = await book(page)

  const ids = await page.evaluate(async (bookId) => {
    const id = (): string => crypto.randomUUID()
    const now = Date.now()
    const hid = id()
    const nid = id()
    const sid = id()
    await window.api.annotations.upsertHighlight({
      id: hid,
      bookId,
      page: 2,
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }],
      text: 'Lorem ipsum',
      color: 'green',
      style: 'wavy',
      noteId: nid,
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.upsertNote({
      id: nid,
      bookId,
      page: 2,
      anchor: { highlightId: hid },
      body: '**remember** this',
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.upsertNote({
      id: id(),
      bookId,
      page: 3,
      anchor: { point: { x: 0.5, y: 0.5 } },
      body: 'sticky',
      createdAt: now,
      updatedAt: now + 5
    })
    await window.api.annotations.addInk([
      {
        id: sid,
        bookId,
        page: 4,
        points: [
          [0.1, 0.1, 0.5],
          [0.2, 0.25, 0.75],
          [0.3, 0.4, 1]
        ],
        color: '#d0342c',
        width: 0.005,
        tool: 'pen',
        createdAt: now
      }
    ])
    const bm = await window.api.annotations.toggleBookmark(bookId, 5, 'chapter', undefined)
    return { hid, nid, sid, bm }
  }, bookId)
  expect(ids.bm?.page).toBe(5)

  await app.close()
  app = await launch(userData)
  page = app.page
  const a = await page.evaluate((b) => window.api.annotations.listForBook(b), bookId)
  expect(a.highlights).toHaveLength(1)
  expect(a.highlights[0]).toMatchObject({ page: 2, color: 'green', style: 'wavy', noteId: ids.nid })
  expect(a.highlights[0].rects).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }])
  expect(a.notes).toHaveLength(2)
  expect(a.notes.find((n) => n.id === ids.nid)?.body).toBe('**remember** this')
  expect(a.ink).toHaveLength(1)
  // Ink points are stored as float32, so compare with tolerance.
  const pts = a.ink[0].points
  expect(pts).toHaveLength(3)
  expect(pts[1][0]).toBeCloseTo(0.2, 5)
  expect(pts[1][1]).toBeCloseTo(0.25, 5)
  expect(pts[1][2]).toBeCloseTo(0.75, 5)
  expect(a.bookmarks[0]).toMatchObject({ page: 5, label: 'chapter' })
})

test('toggle removes a bookmark; rename and note tags work; deleting a highlight removes its note', async () => {
  app = await launch()
  const { page } = app
  const bookId = await book(page)
  const out = await page.evaluate(async (bookId) => {
    const first = await window.api.annotations.toggleBookmark(bookId, 9, null, undefined)
    await window.api.annotations.renameBookmark(first!.id, 'renamed')
    const afterRename = (await window.api.annotations.listForBook(bookId)).bookmarks[0].label
    const second = await window.api.annotations.toggleBookmark(bookId, 9, null, undefined)
    const left = (await window.api.annotations.listForBook(bookId)).bookmarks.length

    const now = Date.now()
    const hid = crypto.randomUUID()
    const nid = crypto.randomUUID()
    await window.api.annotations.upsertHighlight({
      id: hid,
      bookId,
      page: 1,
      rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
      text: 't',
      color: 'yellow',
      style: 'highlight',
      noteId: nid,
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.upsertNote({
      id: nid,
      bookId,
      page: 1,
      anchor: { highlightId: hid },
      body: 'n',
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.setNoteTags(nid, ['idea', 'idea', 'review'])
    const tags = (await window.api.annotations.listForBook(bookId)).notes[0].tags
    await window.api.annotations.upsertNote({
      id: nid,
      bookId,
      page: 1,
      anchor: { highlightId: hid },
      body: 'edited',
      createdAt: now,
      updatedAt: now + 1
    })
    const tagsAfterEdit = (await window.api.annotations.listForBook(bookId)).notes[0].tags
    await window.api.annotations.deleteHighlight(hid)
    const after = await window.api.annotations.listForBook(bookId)
    return {
      afterRename,
      secondIsNull: second === null,
      left,
      tags,
      tagsAfterEdit,
      notes: after.notes.length,
      hl: after.highlights.length
    }
  }, bookId)
  expect(out.afterRename).toBe('renamed')
  expect(out.secondIsNull).toBe(true)
  expect(out.left).toBe(0)
  expect(out.tags).toEqual(['idea', 'review'])
  expect(out.tagsAfterEdit).toEqual(['idea', 'review']) // saving a note never changes tags
  expect(out.hl).toBe(0)
  expect(out.notes).toBe(0)
})

test('listAllNotes groups by book with the highlighted quote', async () => {
  app = await launch()
  const { page } = app
  const bookId = await book(page)
  await page.evaluate(async (bookId) => {
    const now = Date.now()
    const hid = crypto.randomUUID()
    const nid = crypto.randomUUID()
    await window.api.annotations.upsertHighlight({
      id: hid,
      bookId,
      page: 1,
      rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
      text: 'the quoted words',
      color: 'yellow',
      style: 'note',
      noteId: nid,
      createdAt: now,
      updatedAt: now
    })
    await window.api.annotations.upsertNote({
      id: nid,
      bookId,
      page: 1,
      anchor: { highlightId: hid },
      body: 'my note',
      createdAt: now,
      updatedAt: now
    })
  }, bookId)
  const groups = await page.evaluate(() => window.api.annotations.listAllNotes())
  expect(groups).toHaveLength(1)
  expect(groups[0].book.id).toBe(bookId)
  expect(groups[0].notes[0].quote).toBe('the quoted words')
  expect(groups[0].notes[0].note.body).toBe('my note')
})

test('invalid input is rejected with a clear error and writes nothing', async () => {
  app = await launch()
  const { page } = app
  const bookId = await book(page)
  const bad = [
    `await api.annotations.upsertNote({ id: 'not-a-uuid', bookId: '${bookId}', page: 1, anchor: {}, body: 'x', createdAt: 1, updatedAt: 1 })`,
    `await api.annotations.upsertNote({ id: crypto.randomUUID(), bookId: '${'f'.repeat(64)}', page: 1, anchor: {}, body: 'x', createdAt: 1, updatedAt: 1 })`,
    `await api.annotations.upsertHighlight({ id: crypto.randomUUID(), bookId: '${bookId}', page: 0, rects: [], text: '', color: 'yellow', style: 'highlight', noteId: null, createdAt: 1, updatedAt: 1 })`,
    `await api.annotations.addInk([])`,
    `await api.annotations.setNoteTags(crypto.randomUUID(), ['a','b','c','d'])`
  ]
  for (const src of bad) {
    const msg = await errorOf(page, src)
    expect(msg, src).not.toBe('ok')
  }
  const a = await page.evaluate((b) => window.api.annotations.listForBook(b), bookId)
  expect(a.notes).toHaveLength(0)
  expect(a.highlights).toHaveLength(0)
})
