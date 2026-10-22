import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { shouldPlayTurnSound } from '@renderer/reader/sound'

describe('turn sound', () => {
  const on = { ...DEFAULT_SETTINGS, turnSound: true }
  it('is off by default', () => {
    expect(shouldPlayTurnSound(DEFAULT_SETTINGS, false)).toBe(false)
  })
  it('plays when switched on, unless turns are instant or motion is reduced', () => {
    expect(shouldPlayTurnSound(on, false)).toBe(true)
    expect(shouldPlayTurnSound({ ...on, pageTurnStyle: 'instant' }, false)).toBe(false)
    expect(shouldPlayTurnSound(on, true)).toBe(false)
  })
})
