import { describe, it, expect } from 'vitest'
import {
  customUrlProblem,
  effectiveSite,
  lookupUrl,
  siteLabel,
  type LookupPrefs
} from '@shared/lookup'
import { SettingsPartialSchema } from '@shared/ipc'

const prefs = (p: Partial<LookupPrefs> = {}): LookupPrefs => ({
  lookupSite: 'wikipedia',
  lookupLanguage: 'en',
  lookupCustomUrl: '',
  ...p
})

describe('lookupUrl', () => {
  it('builds each built-in site address with the phrase encoded', () => {
    expect(lookupUrl(prefs(), 'French Revolution')).toBe(
      'https://en.wikipedia.org/wiki/Special:Search?search=French%20Revolution'
    )
    expect(lookupUrl(prefs({ lookupSite: 'wiktionary', lookupLanguage: 'fr' }), 'été')).toBe(
      'https://fr.wiktionary.org/wiki/Special:Search?search=%C3%A9t%C3%A9'
    )
    expect(lookupUrl(prefs({ lookupSite: 'google' }), 'a&b?')).toBe(
      'https://www.google.com/search?q=a%26b%3F'
    )
    expect(lookupUrl(prefs({ lookupSite: 'merriam-webster' }), ' ennui ')).toBe(
      'https://www.merriam-webster.com/dictionary/ennui'
    )
  })

  it('uses a valid custom address, and falls back to Wikipedia for an invalid one', () => {
    const bing = prefs({
      lookupSite: 'custom',
      lookupCustomUrl: 'https://www.bing.com/search?q={query}'
    })
    expect(lookupUrl(bing, 'sea otter')).toBe('https://www.bing.com/search?q=sea%20otter')
    expect(effectiveSite(bing)).toBe('custom')
    expect(siteLabel(bing)).toBe('bing.com')

    const broken = prefs({ lookupSite: 'custom', lookupCustomUrl: 'https://example.com/search' })
    expect(effectiveSite(broken)).toBe('wikipedia')
    expect(lookupUrl(broken, 'x')).toContain('wikipedia.org')
  })

  it('explains what is wrong with a custom address', () => {
    expect(customUrlProblem('')).toMatch(/Enter/)
    expect(customUrlProblem('https://x.com/')).toMatch(/\{query\}/)
    expect(customUrlProblem('javascript:alert({query})')).toMatch(/http/)
    expect(customUrlProblem('not a url {query}')).toMatch(/valid/)
    expect(customUrlProblem('https://x.com/?q={query}')).toBeNull()
  })

  it('settings accept only known sites and language codes', () => {
    expect(SettingsPartialSchema.safeParse({ lookupSite: 'google' }).success).toBe(true)
    expect(SettingsPartialSchema.safeParse({ lookupSite: 'evil' }).success).toBe(false)
    expect(SettingsPartialSchema.safeParse({ lookupLanguage: 'pt' }).success).toBe(true)
    expect(SettingsPartialSchema.safeParse({ lookupLanguage: 'x.evil.com/' }).success).toBe(false)
  })
})
