import { BrowserWindow, ipcMain, net, session, shell } from 'electron'
import {
  Channels,
  LookupLanguageSchema,
  LookupOpenInSchema,
  LookupQuerySchema,
  LookupUrlSchema,
  type WikiSummary
} from '@shared/ipc'
import { parse } from './validate'

const UA = 'PageTurn/1.0 (desktop PDF reader; look-up feature)'
const TIMEOUT_MS = 8000
const MAX_THUMB_BYTES = 1_000_000
const EXTRACT_CHARS = 600

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export type LookupDeps = {
  fetch: Fetch
  openExternal(url: string): Promise<void> | void
  openWindow(url: string): void
}

const isWeb = (u: string): boolean => /^https?:\/\//i.test(u)

/** Trims an extract to whole sentences within EXTRACT_CHARS. */
function trimExtract(text: string): string {
  if (text.length <= EXTRACT_CHARS) return text
  const cut = text.slice(0, EXTRACT_CHARS)
  const end = cut.lastIndexOf('. ')
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/**
 * Best-matching Wikipedia article for a phrase: the exact title (following redirects), else the
 * top search hit. Fetched here, not in the page, so the renderer CSP stays `default-src 'self'`.
 */
export async function wikipediaSummary(
  fetch: Fetch,
  query: string,
  lang: string
): Promise<WikiSummary | null> {
  const base = `https://${lang}.wikipedia.org`
  const get = (url: string): Promise<Response> =>
    fetch(url, {
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  const summary = async (title: string): Promise<Record<string, unknown> | null> => {
    const res = await get(
      `${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`
    )
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    return typeof json.extract === 'string' && json.extract ? json : null
  }

  let page = await summary(query)
  if (!page) {
    const res = await get(
      `${base}/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`
    )
    if (!res.ok) return null
    const hits = ((await res.json()) as { query?: { search?: { title: string }[] } }).query?.search
    if (!hits?.length) return null
    page = await summary(hits[0].title)
    if (!page) return null
  }

  const title = String(page.title ?? query)
  const urls = page.content_urls as { desktop?: { page?: string } } | undefined
  const url =
    urls?.desktop?.page && isWeb(urls.desktop.page)
      ? urls.desktop.page
      : `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  return {
    title,
    description: typeof page.description === 'string' ? page.description : null,
    extract: trimExtract(String(page.extract)),
    thumbnail: await thumbnail(get, page.thumbnail as { source?: string } | undefined),
    url
  }
}

/** The article image as a data: URL (small images only), or null. */
async function thumbnail(
  get: (url: string) => Promise<Response>,
  thumb: { source?: string } | undefined
): Promise<string | null> {
  if (!thumb?.source || !/^https:\/\//.test(thumb.source)) return null
  try {
    const res = await get(thumb.source)
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml)/.test(type)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_THUMB_BYTES) return null
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

let lookupWin: BrowserWindow | null = null

/**
 * A small separate window for look-up results: sandboxed, no preload, its own session, web
 * addresses only. Reused for every look-up.
 */
function openLookupWindow(parent: BrowserWindow, url: string): void {
  if (lookupWin && !lookupWin.isDestroyed()) {
    void lookupWin.loadURL(url)
    lookupWin.show()
    lookupWin.focus()
    return
  }
  const partition = 'persist:lookup'
  session.fromPartition(partition).setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  const [px, py] = parent.getPosition()
  const [pw] = parent.getSize()
  const width = 520
  lookupWin = new BrowserWindow({
    width,
    height: 760,
    x: Math.max(0, px + pw - width - 24),
    y: py + 48,
    title: 'Look up',
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  const wc = lookupWin.webContents
  wc.on('will-navigate', (e, target) => {
    if (!isWeb(target)) e.preventDefault()
  })
  // Links that want a new window open in this one.
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isWeb(target)) void wc.loadURL(target)
    return { action: 'deny' }
  })
  lookupWin.on('closed', () => (lookupWin = null))
  void lookupWin.loadURL(url)
}

export function registerLookupIpc(
  parent: BrowserWindow,
  deps: LookupDeps = {
    fetch: (url, init) => net.fetch(url, init),
    openExternal: (url) => shell.openExternal(url),
    openWindow: (url) => openLookupWindow(parent, url)
  }
): void {
  ipcMain.handle(Channels.lookupWikipedia, async (_e, q: unknown, l: unknown) => {
    const query = parse(LookupQuerySchema, q)
    const lang = parse(LookupLanguageSchema, l)
    try {
      return await wikipediaSummary(deps.fetch, query, lang)
    } catch (err) {
      throw new Error(`Wikipedia could not be reached (${(err as Error).message})`, {
        cause: err
      })
    }
  })

  ipcMain.handle(Channels.lookupOpen, async (_e, u: unknown, w: unknown) => {
    const url = parse(LookupUrlSchema, u)
    if (parse(LookupOpenInSchema, w) === 'browser') await deps.openExternal(url)
    else deps.openWindow(url)
  })
}
