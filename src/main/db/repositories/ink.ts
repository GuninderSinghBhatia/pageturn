import type Database from 'better-sqlite3'
import type { InkStroke, InkTool } from '@shared/types'

type InkRow = {
  id: string
  book_id: string
  page: number
  points_blob: Buffer
  color: string
  width: number
  tool: string
  created_at: number
}

/** Points are stored as a packed Float32Array blob [x, y, p, …]. */
const pack = (points: InkStroke['points']): Buffer =>
  Buffer.from(new Float32Array(points.flat()).buffer)

function unpack(blob: Buffer): InkStroke['points'] {
  const f = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
  const out: InkStroke['points'] = []
  for (let i = 0; i + 2 < f.length; i += 3) out.push([f[i], f[i + 1], f[i + 2]])
  return out
}

export class InkRepo {
  constructor(private db: Database.Database) {}

  listForBook(bookId: string): InkStroke[] {
    const rows = this.db
      .prepare('SELECT * FROM ink_strokes WHERE book_id = ? ORDER BY page, created_at')
      .all(bookId) as InkRow[]
    return rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      page: r.page,
      points: unpack(r.points_blob),
      color: r.color,
      width: r.width,
      tool: r.tool as InkTool,
      createdAt: r.created_at
    }))
  }

  add(strokes: InkStroke[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
       VALUES (@id, @bookId, @page, @blob, @color, @width, @tool, @createdAt)`
    )
    this.db.transaction(() => {
      for (const s of strokes) stmt.run({ ...s, blob: pack(s.points) })
    })()
  }

  delete(ids: string[]): void {
    const stmt = this.db.prepare('DELETE FROM ink_strokes WHERE id = ?')
    this.db.transaction(() => {
      for (const id of ids) stmt.run(id)
    })()
  }
}
