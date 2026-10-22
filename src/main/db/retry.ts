/**
 * Runs a database write, retrying on failure (e.g. SQLITE_BUSY) after 200 ms, then 400 ms
 * (delays double from `baseMs`). Rejects with the last error after `attempts` tries.
 */
export async function withRetry<T>(
  fn: () => T,
  opts: { attempts?: number; baseMs?: number; onRetry?: (n: number) => void } = {}
): Promise<T> {
  const { attempts = 3, baseMs = 200, onRetry } = opts
  for (let i = 1; ; i++) {
    try {
      return fn()
    } catch (err) {
      if (i >= attempts) throw err
      onRetry?.(i)
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)))
    }
  }
}
