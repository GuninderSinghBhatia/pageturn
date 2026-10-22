import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  WebContentsView: class {},
  session: {},
  shell: { openExternal: vi.fn() }
}))

import { isAllowedNavigation, SearchViewManager, searchUrl } from '../../../src/main/web/searchView'

describe('searchUrl', () => {
  it('builds each engine URL, encoding the query', () => {
    expect(searchUrl('duckduckgo', 'what is entropy', null, false)).toBe(
      'https://duckduckgo.com/?q=what%20is%20entropy'
    )
    expect(searchUrl('google', 'a&b', null, false)).toBe('https://www.google.com/search?q=a%26b')
    expect(searchUrl('bing', 'x', null, false)).toBe('https://www.bing.com/search?q=x')
  })

  it('appends the book title in quotes when asked', () => {
    expect(searchUrl('duckduckgo', 'entropy', 'Physics', true)).toBe(
      'https://duckduckgo.com/?q=entropy%20%22Physics%22'
    )
    expect(searchUrl('duckduckgo', 'entropy', 'Physics', false)).toBe(
      'https://duckduckgo.com/?q=entropy'
    )
    expect(searchUrl('duckduckgo', 'entropy', null, true)).toBe('https://duckduckgo.com/?q=entropy')
  })
})

describe('isAllowedNavigation', () => {
  it('allows only web addresses', () => {
    expect(isAllowedNavigation('https://x.org/a')).toBe(true)
    expect(isAllowedNavigation('http://x.org')).toBe(true)
    expect(isAllowedNavigation('file:///C:/')).toBe(false)
    expect(isAllowedNavigation('javascript:alert(1)')).toBe(false)
    expect(isAllowedNavigation('ms-settings:')).toBe(false)
    expect(isAllowedNavigation('not a url')).toBe(false)
  })
})

/** A WebContentsView stand-in recording handlers and calls. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture
function fakeView() {
  const handlers: Record<string, (...a: unknown[]) => unknown> = {}
  let openHandler: ((d: { url: string }) => { action: string }) | null = null
  let permissionHandler: ((wc: unknown, perm: string, cb: (ok: boolean) => void) => void) | null =
    null
  const view = {
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(async () => {}),
      getURL: vi.fn(() => 'https://duckduckgo.com/?q=x'),
      isLoading: vi.fn(() => false),
      reload: vi.fn(),
      on: (ev: string, fn: (...a: unknown[]) => unknown) => {
        handlers[ev] = fn
      },
      setWindowOpenHandler: (fn: typeof openHandler) => {
        openHandler = fn
      },
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => false,
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      session: {
        setPermissionRequestHandler: (fn: typeof permissionHandler) => {
          permissionHandler = fn
        }
      }
    }
  }
  return {
    view,
    handlers,
    open: (url: string) => openHandler!({ url }),
    permission: (perm: string) => {
      let result: boolean | null = null
      permissionHandler!(null, perm, (ok) => (result = ok))
      return result
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture
function setup() {
  const fake = fakeView()
  const added: unknown[] = []
  const win = {
    contentView: {
      addChildView: vi.fn((v) => added.push(v)),
      removeChildView: vi.fn((v) => added.splice(added.indexOf(v), 1))
    },
    isDestroyed: () => false
  }
  const openExternal = vi.fn()
  const createView = vi.fn(() => fake.view)
  const m = new SearchViewManager(win as never, {
    createView: createView as never,
    openExternal
  })
  return { m, fake, win, added, openExternal, createView }
}

const bounds = { x: 10, y: 20, width: 300, height: 400 }

describe('SearchViewManager', () => {
  it('shows the page in a view at the given bounds', () => {
    const { m, fake, added } = setup()
    m.show('https://duckduckgo.com/?q=x', bounds)
    expect(added).toEqual([fake.view])
    expect(fake.view.setBounds).toHaveBeenCalledWith(bounds)
    expect(fake.view.webContents.loadURL).toHaveBeenCalledWith('https://duckduckgo.com/?q=x')
  })

  it('new windows open in the browser (web addresses only) and are denied in-app', () => {
    const { m, fake, openExternal } = setup()
    m.show('https://duckduckgo.com/?q=x', bounds)
    expect(fake.open('https://example.com')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(fake.open('file:///C:/Windows/win.ini')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('blocks navigation to non-web schemes and denies every permission', () => {
    const { m, fake } = setup()
    m.show('https://duckduckgo.com/?q=x', bounds)
    const blocked = { preventDefault: vi.fn() }
    fake.handlers['will-navigate'](blocked, 'file:///C:/')
    expect(blocked.preventDefault).toHaveBeenCalled()
    const allowed = { preventDefault: vi.fn() }
    fake.handlers['will-navigate'](allowed, 'https://en.wikipedia.org/wiki/Entropy')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(fake.permission('media')).toBe(false)
    expect(fake.permission('geolocation')).toBe(false)
  })

  it('hide then show reuses the same view (history kept)', () => {
    const { m, added, createView } = setup()
    m.show('https://duckduckgo.com/?q=x', bounds)
    m.hide()
    expect(added).toEqual([])
    m.show('https://duckduckgo.com/?q=y', bounds)
    expect(createView).toHaveBeenCalledTimes(1)
    expect(added).toHaveLength(1)
  })

  it('reports state, and a failed load as offline (but not an aborted one)', () => {
    const { m, fake } = setup()
    const states: { error: string | null; canGoBack: boolean }[] = []
    m.onState((s) => states.push(s))
    m.show('https://duckduckgo.com/?q=x', bounds)
    fake.handlers['did-fail-load']({}, -3)
    expect(states.at(-1)?.error).toBeNull()
    fake.handlers['did-fail-load']({}, -106)
    expect(states.at(-1)?.error).toBe('offline')
    expect(states.at(-1)?.canGoBack).toBe(true)
  })
})
