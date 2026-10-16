/** Sites the reader can look a phrase up on (Settings → Look up). */
export const LOOKUP_SITES = [
  'wikipedia',
  'wiktionary',
  'merriam-webster',
  'britannica',
  'google',
  'duckduckgo',
  'custom'
] as const
export type LookupSite = (typeof LOOKUP_SITES)[number]
export type LookupOpenIn = 'app' | 'browser'

type SiteInfo = { label: string; template: string; usesLanguage?: boolean }

/** `{lang}` is the Wikipedia language code, `{query}` the URL-encoded phrase. */
export const SITE_INFO: Record<Exclude<LookupSite, 'custom'>, SiteInfo> = {
  wikipedia: {
    label: 'Wikipedia',
    template: 'https://{lang}.wikipedia.org/wiki/Special:Search?search={query}',
    usesLanguage: true
  },
  wiktionary: {
    label: 'Wiktionary',
    template: 'https://{lang}.wiktionary.org/wiki/Special:Search?search={query}',
    usesLanguage: true
  },
  'merriam-webster': {
    label: 'Merriam-Webster',
    template: 'https://www.merriam-webster.com/dictionary/{query}'
  },
  britannica: { label: 'Britannica', template: 'https://www.britannica.com/search?query={query}' },
  google: { label: 'Google', template: 'https://www.google.com/search?q={query}' },
  duckduckgo: { label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q={query}' }
}

/** Wikipedia / Wiktionary languages offered in Settings (code → name). */
export const LOOKUP_LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['pa', 'ਪੰਜਾਬੀ'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh', '中文']
]

export const LANGUAGE_RE = /^[a-z]{2,3}(-[a-z]{2,8})?$/

/** A custom site: an http(s) URL with a `{query}` placeholder. Returns why not, or null if OK. */
export function customUrlProblem(template: string): string | null {
  const t = template.trim()
  if (!t) return 'Enter the address of the site.'
  if (!t.includes('{query}')) return 'Put {query} where the looked-up text should go.'
  try {
    const u = new URL(t.replaceAll('{query}', 'test'))
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      return 'Use an http:// or https:// address.'
  } catch {
    return 'That is not a valid web address.'
  }
  return null
}

export type LookupPrefs = {
  lookupSite: LookupSite
  lookupLanguage: string
  lookupCustomUrl: string
}

/** The site actually used: a custom site with an invalid address falls back to Wikipedia. */
export function effectiveSite(p: LookupPrefs): LookupSite {
  return p.lookupSite === 'custom' && customUrlProblem(p.lookupCustomUrl)
    ? 'wikipedia'
    : p.lookupSite
}

export function siteLabel(p: LookupPrefs): string {
  const site = effectiveSite(p)
  if (site !== 'custom') return SITE_INFO[site].label
  try {
    return new URL(p.lookupCustomUrl.trim().replaceAll('{query}', 'x')).hostname.replace(
      /^www\./,
      ''
    )
  } catch {
    return 'Custom site'
  }
}

/** Address that looks `query` up on the chosen site. */
export function lookupUrl(p: LookupPrefs, query: string): string {
  const site = effectiveSite(p)
  const template = site === 'custom' ? p.lookupCustomUrl.trim() : SITE_INFO[site].template
  const lang = LANGUAGE_RE.test(p.lookupLanguage) ? p.lookupLanguage : 'en'
  return template.replaceAll('{lang}', lang).replaceAll('{query}', encodeURIComponent(query.trim()))
}
