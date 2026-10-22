import { shell, WebContentsView, type BrowserWindow } from 'electron'
import type { SearchEngine } from '@shared/ai'

export type Bounds = { x: number; y: number; width: number; height: number }
export type WebState = {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  error: string | null
}

const ENGINE_URL: Record<SearchEngine, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q='
}

/** Search address for a query, optionally with the book title (in quotes) added. */
export function searchUrl(
  engine: SearchEngine,
  query: string,
  bookTitle: string | null,
  includeTitle: boolean
): string {
  const q = includeTitle && bookTitle ? `${query} "${bookTitle}"` : query
  return ENGINE_URL[engine] + encodeURIComponent(q)
}

export function isAllowedNavigation(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const ABORTED = -3 // net::ERR_ABORTED: a navigation replaced by another, not a failure

/**
 * The Help panel's Web tab: a main-owned WebContentsView placed over the rectangle the
 * renderer reserves for it. Isolated session (persist:websearch), sandboxed, no preload;
 * pop-ups go to the browser, non-web schemes are blocked, permissions are denied.
 */
export class SearchViewManager {
  private view: WebContentsView | null = null
  private shown = false
  private error: string | null = null
  private pendingUrl = '' // requested but not yet committed (getURL() is '' until then)
  private listeners: ((s: WebState) => void)[] = []
  private createView: () => WebContentsView
  private openExternal: (url: string) => void

  constructor(
    private win: BrowserWindow,
    opts: { createView?: () => WebContentsView; openExternal?: (url: string) => void } = {}
  ) {
    this.createView =
      opts.createView ??
      (() =>
        new WebContentsView({
          webPreferences: {
            partition: 'persist:websearch',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        }))
    this.openExternal = opts.openExternal ?? ((url) => void shell.openExternal(url))
  }

  private ensure(): WebContentsView {
    if (this.view) return this.view
    const view = this.createView()
    const wc = view.webContents
    wc.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url)) this.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      if (!isAllowedNavigation(url)) e.preventDefault()
    })
    wc.on('did-start-loading', () => {
      this.error = null
      this.emit()
    })
    wc.on('did-stop-loading', () => this.emit())
    wc.on('did-navigate', () => this.emit())
    wc.on('did-navigate-in-page', () => this.emit())
    wc.on('did-fail-load', (_e, code) => {
      if (code === ABORTED) return this.emit()
      this.error = 'offline'
      this.emit()
    })
    this.view = view
    return view
  }

  private emit(): void {
    const s = this.state()
    if (s) for (const l of this.listeners) l(s)
  }

  state(): WebState | null {
    if (!this.view) return null
    const wc = this.view.webContents
    return {
      url: wc.getURL() || this.pendingUrl,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      error: this.error
    }
  }

  show(url: string, bounds: Bounds): void {
    if (!isAllowedNavigation(url)) return
    const view = this.ensure()
    if (!this.shown) {
      this.win.contentView.addChildView(view)
      this.shown = true
    }
    view.setBounds(bounds)
    this.error = null
    this.pendingUrl = url
    void view.webContents.loadURL(url).catch(() => undefined) // failures arrive as did-fail-load
    this.emit()
  }

  /** Shows the view again (same page and history) without navigating. */
  reveal(bounds: Bounds): void {
    if (!this.view) return
    if (!this.shown) {
      this.win.contentView.addChildView(this.view)
      this.shown = true
    }
    this.view.setBounds(bounds)
  }

  setBounds(b: Bounds): void {
    if (this.view && this.shown) this.view.setBounds(b)
  }

  /** Takes the view off the window; it keeps its page and history for next time. */
  hide(): void {
    if (!this.view || !this.shown) return
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.view)
    this.shown = false
  }

  back(): void {
    if (this.view?.webContents.navigationHistory.canGoBack())
      this.view.webContents.navigationHistory.goBack()
  }

  forward(): void {
    if (this.view?.webContents.navigationHistory.canGoForward())
      this.view.webContents.navigationHistory.goForward()
  }

  reload(): void {
    this.error = null
    this.view?.webContents.reload()
  }

  currentUrl(): string | null {
    return this.view?.webContents.getURL() || null
  }

  openExternalCurrent(): void {
    const url = this.currentUrl()
    if (url && isAllowedNavigation(url)) this.openExternal(url)
  }

  onState(cb: (s: WebState) => void): void {
    this.listeners.push(cb)
  }
}
