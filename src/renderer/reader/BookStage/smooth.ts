import { useEffect, useRef, useState } from 'react'

const TAU_MS = 40 // time constant: ~95% of the way in 120 ms, settled by ~200 ms
const SNAP = 0.003

/** One frame of an exponential glide toward `target` (never overshoots; snaps when close). */
export function approach(current: number, target: number, dtMs: number): number {
  const next = target + (current - target) * Math.exp(-dtMs / TAU_MS)
  return Math.abs(next - target) < SNAP ? target : next
}

/** A value that glides to `target` over a few frames instead of jumping. */
export function useSmoothValue(target: number): number {
  const [value, setValue] = useState(target)
  const valueRef = useRef(target)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const step = (now: number): void => {
      const next = approach(valueRef.current, target, Math.min(50, now - last))
      last = now
      valueRef.current = next
      setValue(next)
      if (next !== target) raf = requestAnimationFrame(step)
    }
    if (valueRef.current !== target) raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return value
}
