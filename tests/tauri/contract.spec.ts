import { test, expect } from '@playwright/test'
import { launch, type Running } from './helpers'

/**
 * Calls every Rust command with harmless arguments. A command still returning the stub error
 * ("Not available in the Tauri build yet") fails the test; any other outcome (a result, or a
 * validation error such as "Unknown book") proves the command is implemented and reachable.
 */

const ID = '00000000-0000-4000-8000-000000000000'
const BOOK = 'a'.repeat(64)

// [command, args]. Commands that open dialogs or windows get arguments that fail validation first.
const CALLS: [string, Record<string, unknown>][] = [
  ['library_list', {}],
  ['library_import', { paths: ['Z:/does-not-exist.pdf'] }],
  ['library_remove', { bookId: BOOK, deleteAnnotations: false }],
  ['library_relocate', { bookId: BOOK }],
  ['library_get_file', { bookId: BOOK }],
  ['library_save_thumbnail', { bookId: BOOK, pngBase64: 'AAAA' }],
  ['library_update_meta', { bookId: BOOK, meta: { numPages: 1 } }],
  ['library_set_liked', { bookId: BOOK, liked: true }],
  ['reader_save_progress', { bookId: BOOK, page: 1 }],
  ['annotations_list_for_book', { bookId: BOOK }],
  ['annotations_upsert_highlight', { h: {} }],
  ['annotations_delete_highlight', { id: ID }],
  ['annotations_upsert_note', { n: {} }],
  ['annotations_delete_note', { id: ID }],
  ['annotations_set_note_tags', { id: ID, tags: [] }],
  ['annotations_add_ink', { strokes: [] }],
  ['annotations_delete_ink', { ids: [] }],
  ['annotations_toggle_bookmark', { bookId: BOOK, page: 1, label: null, id: null }],
  ['annotations_rename_bookmark', { id: ID, label: null }],
  ['annotations_list_all_notes', {}],
  ['settings_get', {}],
  ['settings_set', { partial: {} }],
  ['settings_has_api_key', { provider: 'openai' }],
  ['settings_clear_api_key', { provider: 'openai' }],
  ['settings_set_api_key', { provider: 'nope', key: 'x' }],
  ['export_markdown', { bookId: BOOK }],
  ['export_markdown_text', { bookId: BOOK }],
  ['ai_test_key', { provider: 'nope' }],
  ['ai_list_models', { provider: 'nope' }],
  ['ai_cancel', { requestId: 'r1' }],
  ['lookup_open', { url: 'ftp://nope', where: 'browser' }],
  ['rag_health', {}],
  ['rag_ask', { question: 'hi', currentPage: 1 }],
  ['rag_who', { name: 'x', currentPage: 1 }],
  ['window_fit_aspect', { aspect: 0 }],
  ['window_get_state', {}],
  ['app_set_unsaved', { count: 0 }],
  ['app_report_error', { message: 'contract test', stack: null }],
  ['app_version', {}],
  ['app_check_for_updates', {}],
  ['web_show', { query: 'x', bounds: { x: -5 }, bookTitle: null }],
  ['web_set_bounds', { bounds: { x: -5 } }]
]

let app: Running

test.beforeAll(async () => {
  app = await launch()
})
test.afterAll(async () => {
  await app.close()
})

test('every command is implemented (no stub errors)', async () => {
  const results = await app.page.evaluate(async (calls) => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke(c: string, a?: unknown): Promise<unknown> }
      }
    ).__TAURI_INTERNALS__.invoke
    const out: { cmd: string; outcome: string }[] = []
    for (const [cmd, args] of calls) {
      try {
        await invoke(cmd, args)
        out.push({ cmd, outcome: 'ok' })
      } catch (e) {
        out.push({ cmd, outcome: String(e) })
      }
    }
    return out
  }, CALLS)
  const stubs = results.filter((r) => /Not available in the Tauri build yet/.test(r.outcome))
  expect(stubs, JSON.stringify(stubs)).toEqual([])
  expect(results.length).toBe(CALLS.length)
})

test('window.api exposes the full Api surface', async () => {
  const shape = await app.page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.api).map(([k, v]) => [
        k,
        typeof v === 'object' ? Object.keys(v as object).sort() : typeof v
      ])
    )
  )
  expect(Object.keys(shape).sort()).toEqual(
    [
      'ai',
      'annotations',
      'app',
      'export',
      'library',
      'lookup',
      'rag',
      'reader',
      'settings',
      'web',
      'window'
    ].sort()
  )
  expect((shape.library as string[]).length).toBe(12)
  expect((shape.annotations as string[]).length).toBe(11)
})

test('stub-free errors are readable strings (not "[object Object]")', async () => {
  const msg = await app.page.evaluate(async () => {
    try {
      await window.api.library.getFile('b'.repeat(64))
      return 'no error'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  expect(msg).toBe('Unknown book')
})
