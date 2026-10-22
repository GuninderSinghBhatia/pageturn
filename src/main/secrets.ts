import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ProviderId } from '@shared/ai'

/** The parts of Electron's safeStorage the store needs (injected so tests can fake it). */
export type SecretCrypto = {
  isAvailable(): boolean
  encrypt(s: string): Buffer
  decrypt(b: Buffer): string
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super('Secure storage unavailable on this system')
    this.name = 'SecretsUnavailableError'
  }
}

/**
 * API keys, encrypted with the OS keychain (safeStorage) in userData/secrets.bin as
 * JSON `{ [provider]: base64(encrypted) }`. Never in SQLite, never sent to the renderer.
 */
export class SecretStore {
  constructor(
    private file: string,
    private crypto: SecretCrypto
  ) {}

  private read(): Partial<Record<ProviderId, string>> {
    if (!existsSync(this.file)) return {}
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return data && typeof data === 'object' ? (data as Partial<Record<ProviderId, string>>) : {}
    } catch {
      return {}
    }
  }

  private write(data: Partial<Record<ProviderId, string>>): void {
    writeFileSync(this.file, JSON.stringify(data), { mode: 0o600 })
  }

  set(p: ProviderId, key: string): void {
    if (!this.crypto.isAvailable()) throw new SecretsUnavailableError()
    this.write({ ...this.read(), [p]: this.crypto.encrypt(key).toString('base64') })
  }

  /** The key, or null when missing or no longer decryptable (e.g. the OS profile changed). */
  get(p: ProviderId): string | null {
    const blob = this.read()[p]
    if (!blob) return null
    try {
      return this.crypto.decrypt(Buffer.from(blob, 'base64')) || null
    } catch {
      return null
    }
  }

  has(p: ProviderId): boolean {
    return this.get(p) !== null
  }

  clear(p: ProviderId): void {
    const data = this.read()
    if (!(p in data)) return
    delete data[p]
    this.write(data)
  }
}
