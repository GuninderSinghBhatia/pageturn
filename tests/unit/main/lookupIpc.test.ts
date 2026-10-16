import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  BrowserWindow: class {},
  net: { fetch: vi.fn() },
  session: {},
  shell: {}
}))

import { Channels } from '@shared/ipc'
import { registerLookupIpc, wikipediaSummary } from '../../../src/main/ipc/lookup'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake Wikipedia: `pages` are article summaries by title; search returns `hits`. */
function fakeWiki(
  pages: Record<string, object>,
  hits: string[] = []
): ReturnType<typeof vi.fn<(url: string) => Promise<Response>>> {
  return vi.fn(async (url: string): Promise<Response> => {
    const summary = /\/page\/summary\/([^?]+)/.exec(url)
    if (summary) {
      const page = pages[decodeURIComponent(summary[1]).replace(/_/g, ' ')]
      return page ? json(page) : json({ title: 'Not found.' }, 404)
    }
    if (url.includes('list=search'))
      return json({ query: { search: hits.map((title) => ({ title })) } })
    if (url.startsWith('https://upload.wikimedia.org/'))
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
    throw new Error(`unexpected ${url}`)
  })
}

const ocean = {
  title: 'Ocean',
  description: 'Body of salt water',
  extract: 'The ocean is the body of salt water that covers about 70.8% of Earth.',
  thumbnail: { source: 'https://upload.wikimedia.org/ocean.jpg' },
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ocean' } }
}

describe('wikipediaSummary', () => {
  it('returns the article summary with its image inlined as a data URL', async () => {
    const fetch = fakeWiki({ Ocean: ocean })
    expect(await wikipediaSummary(fetch, 'Ocean', 'en')).toEqual({
      title: 'Ocean',
      description: 'Body of salt water',
      extract: ocean.extract,
      thumbnail: 'data:image/jpeg;base64,AQID',
      url: 'https://en.wikipedia.org/wiki/Ocean'
    })
    expect(fetch.mock.calls[0][0]).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/Ocean?redirect=true'
    )
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toHaveProperty('User-Agent')
  })

  it('falls back to the top search hit when there is no exact article', async () => {
    const fetch = fakeWiki({ Ocean: { ...ocean, thumbnail: undefined } }, ['Ocean'])
    const s = await wikipediaSummary(fetch, 'the wide sea', 'en')
    expect(s?.title).toBe('Ocean')
    expect(s?.thumbnail).toBeNull()
  })

  it('null when nothing matches; long extracts are cut at a sentence', async () => {
    expect(await wikipediaSummary(fakeWiki({}), 'qwxzv', 'en')).toBeNull()
    const long = 'A sentence that goes on for a while. '.repeat(40)
    const s = await wikipediaSummary(
      fakeWiki({ Long: { title: 'Long', extract: long } }),
      'Long',
      'de'
    )
    expect(s!.extract.length).toBeLessThanOrEqual(600)
    expect(s!.extract.endsWith('.')).toBe(true)
    expect(s!.url).toBe('https://de.wikipedia.org/wiki/Long')
  })
})

describe('lookup IPC', () => {
  const deps = { fetch: fakeWiki({ Ocean: ocean }), openExternal: vi.fn(), openWindow: vi.fn() }
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerLookupIpc({} as never, deps)
  })
  const call = (ch: string, ...a: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(ch)!({}, ...a))

  it('validates the phrase and the language before fetching', async () => {
    expect(await call(Channels.lookupWikipedia, 'Ocean', 'en')).toMatchObject({ title: 'Ocean' })
    await expect(call(Channels.lookupWikipedia, '   ', 'en')).rejects.toThrow('Invalid payload')
    await expect(call(Channels.lookupWikipedia, 'x', 'evil.com/')).rejects.toThrow(
      'Invalid payload'
    )
  })

  it('opens web addresses in the look-up window or the browser, nothing else', async () => {
    await call(Channels.lookupOpen, 'https://en.wikipedia.org/wiki/Ocean', 'app')
    expect(deps.openWindow).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/Ocean')
    await call(Channels.lookupOpen, 'https://duckduckgo.com/?q=x', 'browser')
    expect(deps.openExternal).toHaveBeenCalledWith('https://duckduckgo.com/?q=x')
    for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'not a url']) {
      await expect(call(Channels.lookupOpen, bad, 'browser')).rejects.toThrow('Invalid payload')
    }
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
  })
})
