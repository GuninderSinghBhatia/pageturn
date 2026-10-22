import { describe, it, expect, vi, afterEach } from 'vitest'
import { withRetry } from '../../../src/main/db/retry'

afterEach(() => vi.useRealTimers())

describe('withRetry', () => {
  it('retries after failures and resolves once the call succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const onRetry = vi.fn()
    const p = withRetry(
      () => {
        calls++
        if (calls < 3) throw new Error('SQLITE_BUSY')
        return 'ok'
      },
      { onRetry }
    )
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(400)
    await expect(p).resolves.toBe('ok')
    expect(calls).toBe(3)
    expect(onRetry.mock.calls.map((c) => c[0])).toEqual([1, 2])
  })

  it('gives up after 3 attempts with the last error', async () => {
    vi.useFakeTimers()
    let calls = 0
    const p = withRetry(() => {
      calls++
      throw new Error(`fail ${calls}`)
    })
    const caught = p.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(200 + 400)
    expect(await caught).toBe('fail 3')
    expect(calls).toBe(3)
  })

  it('waits 200 ms then 400 ms between attempts', async () => {
    vi.useFakeTimers()
    let calls = 0
    void withRetry(() => {
      calls++
      throw new Error('x')
    }).catch(() => {})
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(399)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(3)
  })
})
