import Database from 'better-sqlite3'

// Migration files are bundled as raw strings; each NNN_name.sql moves user_version to NNN.
const files = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const migrations = Object.entries(files)
  .map(([path, sql]) => ({ version: Number(/(\d+)_[^/]+\.sql$/.exec(path)![1]), sql }))
  .sort((a, b) => a.version - b.version)

export function openDb(file: string | ':memory:'): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const current = db.pragma('user_version', { simple: true }) as number
  for (const m of migrations) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
  return db
}
