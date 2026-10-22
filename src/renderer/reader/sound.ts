import type { Settings } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'

const VOLUME = 0.4

/** Off by default; never with instant turns or when the OS asks for reduced motion. */
export function shouldPlayTurnSound(
  s: Pick<Settings, 'turnSound' | 'pageTurnStyle'>,
  reducedMotion: boolean
): boolean {
  return s.turnSound && s.pageTurnStyle !== 'instant' && !reducedMotion
}

let ctx: AudioContext | null = null

/**
 * A soft paper "swish": a short burst of filtered noise whose pitch sweeps down. Made with
 * Web Audio at play time, so there is no sound file to ship or license.
 */
export function playTurnSound(): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (!shouldPlayTurnSound(useSettingsStore.getState().settings, reduced)) return
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    const dur = 0.32
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.8
    filter.frequency.setValueAtTime(3200, now)
    filter.frequency.exponentialRampToValueAtTime(700, now + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(VOLUME, now + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    noise.connect(filter).connect(gain).connect(ctx.destination)
    noise.start(now)
    noise.stop(now + dur)
  } catch {
    // No audio device: turning pages silently is fine.
  }
}
