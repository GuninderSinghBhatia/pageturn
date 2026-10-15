import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const HEAD_BYTES = 1024 * 1024

/** bookId = SHA-256 hex of (first 1 MB of file bytes + file size as decimal string). */
export async function computeBookId(path: string): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES))
    let read = 0
    while (read < buf.length) {
      const { bytesRead } = await fh.read(buf, read, buf.length - read, read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    return createHash('sha256').update(buf.subarray(0, read)).update(String(size)).digest('hex')
  } finally {
    await fh.close()
  }
}
