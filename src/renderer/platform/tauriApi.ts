import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { Api, FileDrop, WindowState } from '@shared/ipc'
import type { Book } from '@shared/types'

/**
 * `window.api`: the `Api` type in src/shared/ipc.ts, backed by the Rust commands in src-tauri.
 * Command names are the old IPC channel names in snake_case (`library:list` -> `library_list`);
 * argument keys are camelCase. Rust -> UI events keep the channel names (`library:changed`,
 * `ai:token`, ...).
 */

const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  invoke<T>(cmd, args).catch((e: unknown) => {
    throw e instanceof Error ? e : new Error(String(e))
  })

/** Subscribes to a Rust -> UI event; returns the unsubscribe function synchronously. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let off: (() => void) | null = null
  let cancelled = false
  void listen<T>(event, (e) => cb(e.payload)).then((un) => {
    if (cancelled) un()
    else off = un
  })
  return () => {
    cancelled = true
    off?.()
  }
}

const bytesToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/** Tauri's window drag-drop event, reduced to what the shelf needs. */
function onFileDrop(cb: (e: FileDrop) => void): () => void {
  let off: (() => void) | null = null
  let cancelled = false
  void getCurrentWebview()
    .onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'drop') cb({ type: 'drop', paths: p.paths })
      else if (p.type === 'leave') cb({ type: 'leave' })
      else cb({ type: 'over' })
    })
    .then((un) => {
      if (cancelled) un()
      else off = un
    })
  return () => {
    cancelled = true
    off?.()
  }
}

const api: Api = {
  library: {
    list: () => call('library_list'),
    import: (paths) => call('library_import', { paths }),
    openDialog: () => call('library_open_dialog'),
    remove: (bookId, deleteAnnotations) => call('library_remove', { bookId, deleteAnnotations }),
    relocate: (bookId) => call('library_relocate', { bookId }),
    // Rust answers with a raw binary response (no JSON round trip for a 30 MB PDF).
    getFile: (bookId) => call<ArrayBuffer>('library_get_file', { bookId }),
    saveThumbnail: (bookId, png) =>
      call('library_save_thumbnail', { bookId, pngBase64: bytesToBase64(png) }),
    updateMeta: (bookId, meta) => call('library_update_meta', { bookId, meta }),
    setLiked: (bookId, liked) => call('library_set_liked', { bookId, liked }),
    onOpenRequest: (cb) => subscribe<Book>('library:openRequest', cb),
    onChanged: (cb) => subscribe<null>('library:changed', () => cb()),
    // Tauri owns OS file drops (dragDropEnabled), so the page gets no HTML drop events for them.
    onFileDrop: (cb) => onFileDrop(cb)
  },
  reader: { saveProgress: (bookId, page) => call('reader_save_progress', { bookId, page }) },
  rag: {
    health: () => call('rag_health'),
    ask: (question, currentPage, bookId) => call('rag_ask', { question, currentPage, bookId }),
    who: (name, currentPage, bookId) => call('rag_who', { name, currentPage, bookId })
  },
  settings: {
    get: () => call('settings_get'),
    set: (partial) => call('settings_set', { partial }),
    setApiKey: (provider, key) => call('settings_set_api_key', { provider, key }),
    hasApiKey: (provider) => call('settings_has_api_key', { provider }),
    clearApiKey: (provider) => call('settings_clear_api_key', { provider })
  },
  annotations: {
    listForBook: (bookId) => call('annotations_list_for_book', { bookId }),
    upsertHighlight: (h) => call('annotations_upsert_highlight', { h }),
    deleteHighlight: (id) => call('annotations_delete_highlight', { id }),
    upsertNote: (n) => call('annotations_upsert_note', { n }),
    deleteNote: (id) => call('annotations_delete_note', { id }),
    setNoteTags: (id, tags) => call('annotations_set_note_tags', { id, tags }),
    addInk: (strokes) => call('annotations_add_ink', { strokes }),
    deleteInk: (ids) => call('annotations_delete_ink', { ids }),
    toggleBookmark: (bookId, page, label, id) =>
      call('annotations_toggle_bookmark', { bookId, page, label: label ?? null, id: id ?? null }),
    renameBookmark: (id, label) => call('annotations_rename_bookmark', { id, label }),
    listAllNotes: () => call('annotations_list_all_notes')
  },
  ai: {
    testKey: (provider) => call('ai_test_key', { provider }),
    listModels: (provider) => call('ai_list_models', { provider }),
    claudeStatus: () => call('ai_claude_status'),
    claudeLogin: () => call('ai_claude_login'),
    explain: (requestId, req) => call('ai_explain', { requestId, req }),
    followUp: (requestId, text) => call('ai_follow_up', { requestId, text }),
    cancel: (requestId) => call('ai_cancel', { requestId }),
    onToken: (cb) => subscribe('ai:token', cb),
    onDone: (cb) => subscribe('ai:done', cb),
    onError: (cb) => subscribe('ai:error', cb)
  },
  app: {
    setUnsaved: (count) => call('app_set_unsaved', { count }),
    reportError: (message, stack) => call('app_report_error', { message, stack: stack ?? null }),
    version: () => call('app_version'),
    checkForUpdates: () => call('app_check_for_updates'),
    installUpdate: () => call('app_install_update'),
    openLogs: () => call('app_open_logs'),
    onUpdateAvailable: (cb) => subscribe('update:available', cb),
    onUpdateDownloaded: (cb) => subscribe('update:downloaded', cb)
  },
  export: {
    markdown: (bookId) => call('export_markdown', { bookId }),
    markdownText: (bookId) => call('export_markdown_text', { bookId }),
    backup: () => call('export_backup'),
    importBackup: () => call('export_import_backup'),
    openDataFolder: () => call('export_open_data_folder')
  },
  web: {
    show: (query, bounds, bookTitle) => call('web_show', { query, bounds, bookTitle }),
    reveal: (bounds) => call('web_reveal', { bounds }),
    setBounds: (bounds) => call('web_set_bounds', { bounds }),
    hide: () => call('web_hide'),
    back: () => call('web_back'),
    forward: () => call('web_forward'),
    reload: () => call('web_reload'),
    openExternal: () => call('web_open_external'),
    onState: (cb) => subscribe('web:state', cb)
  },
  lookup: {
    wikipedia: (query, lang) => call('lookup_wikipedia', { query, lang }),
    open: (url, where) => call('lookup_open', { url, where })
  },
  window: {
    fitAspect: (aspect) => call('window_fit_aspect', { aspect }),
    control: (action) => call('window_control', { action }),
    getState: () => call<WindowState>('window_get_state'),
    onState: (cb) => subscribe<WindowState>('window:state', cb),
    platform: 'win32'
  }
}

/** Installs `window.api`. */
export function install(): void {
  ;(window as unknown as { api: Api }).api = api
}
