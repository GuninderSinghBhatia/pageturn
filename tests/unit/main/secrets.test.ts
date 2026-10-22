import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, SecretsUnavailableError } from '../../../src/main/secrets'

/** Stand-in for safeStorage: "encrypts" by reversing the string. */
const reversing = {
  isAvailable: () => true,
  encrypt: (s: string) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b: Buffer) => [...b.toString('utf8')].reverse().join('')
}
/** A profile change: the stored blob can no longer be decrypted. */
const broken = {
  ...reversing,
  decrypt: (): string => {
    throw new Error('cannot decrypt')
  }
}

const file = (): string => join(mkdtempSync(join(tmpdir(), 'pageturn-secrets-')), 'secrets.bin')

describe('SecretStore', () => {
  it('round-trips a key, and the file never holds the plaintext', () => {
    const f = file()
    const s = new SecretStore(f, reversing)
    s.set('anthropic', 'sk-ant-secret-123')
    expect(s.get('anthropic')).toBe('sk-ant-secret-123')
    expect(s.has('anthropic')).toBe(true)
    expect(readFileSync(f, 'utf8')).not.toContain('sk-ant-secret-123')
    // a fresh store (next launch) reads the same file
    expect(new SecretStore(f, reversing).get('anthropic')).toBe('sk-ant-secret-123')
  })

  it('clear removes the key', () => {
    const s = new SecretStore(file(), reversing)
    s.set('openai', 'sk-o')
    s.clear('openai')
    expect(s.has('openai')).toBe(false)
    expect(s.get('openai')).toBeNull()
  })

  it('a key that can no longer be decrypted reads as missing, without throwing', () => {
    const f = file()
    new SecretStore(f, reversing).set('gemini', 'g-key')
    const after = new SecretStore(f, broken)
    expect(after.get('gemini')).toBeNull()
    expect(after.has('gemini')).toBe(false)
  })

  it('refuses to store a key when secure storage is unavailable', () => {
    const f = file()
    const s = new SecretStore(f, { ...reversing, isAvailable: () => false })
    expect(() => s.set('anthropic', 'sk')).toThrow(SecretsUnavailableError)
    expect(existsSync(f)).toBe(false)
  })

  it('a missing or corrupt file means no keys', () => {
    expect(new SecretStore(file(), reversing).has('anthropic')).toBe(false)
  })
})
