import type Database from 'better-sqlite3'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  /** Stored values merged over DEFAULT_SETTINGS (unknown keys ignored). */
  get(): Settings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as {
      key: string
      value_json: string
    }[]
    const settings: Settings = { ...DEFAULT_SETTINGS }
    for (const { key, value_json } of rows) {
      if (key in settings) (settings as Record<string, unknown>)[key] = JSON.parse(value_json)
    }
    return settings
  }

  set(partial: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) stmt.run(key, JSON.stringify(value))
      }
    })()
    return this.get()
  }
}
