import { useEffect, useState } from 'react'
import { toolbarReveal } from './chromeStore'

const IDLE_MS = 2000

/** True after 2 s without pointer movement or key presses; idling also hides the toolbar. */
export function useIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let last = { x: NaN, y: NaN }
    const wake = (): void => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => {
        setIdle(true)
        toolbarReveal().idle()
      }, IDLE_MS)
    }
    // Chromium replays synthetic moves at a still pointer; only real movement wakes.
    const moved = (e: PointerEvent): void => {
      if (e.clientX === last.x && e.clientY === last.y) return
      last = { x: e.clientX, y: e.clientY }
      wake()
    }
    wake()
    window.addEventListener('pointermove', moved)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', moved)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])
  return idle
}
