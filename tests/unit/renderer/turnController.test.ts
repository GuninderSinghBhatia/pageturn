import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TurnController } from '@renderer/reader/BookStage/turnController'

let t = 0
const now = (): number => t
let commit: ReturnType<typeof vi.fn>

beforeEach(() => {
  t = 0
  commit = vi.fn()
})

const make = (canTurn = (): boolean => true): TurnController =>
  new TurnController({ canTurn, commit, now })

describe('TurnController', () => {
  it('animates a key turn for 600 ms, then commits once and goes idle', () => {
    const c = make()
    c.turn(1)
    expect(c.tick(t).phase).toBe('animating')
    t = 300
    expect(c.tick(t).phase).toBe('animating')
    expect(commit).not.toHaveBeenCalled()
    t = 600
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(1)
  })

  it('a second turn during an animation snaps the first to completion', () => {
    const c = make()
    c.turn(1)
    t = 100
    c.tick(t)
    c.turn(1)
    expect(commit).toHaveBeenCalledOnce() // first turn committed immediately
    expect(c.tick(t).phase).toBe('animating')
    t = 700
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).toHaveBeenCalledTimes(2)
    t = 5000
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).toHaveBeenCalledTimes(2) // nothing extra queued
  })

  it('stays idle when the turn is not allowed', () => {
    const c = make(() => false)
    c.turn(1)
    expect(c.tick(t).phase).toBe('idle')
    c.pointerDown('br', { x: 1, y: 1.4 })
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).not.toHaveBeenCalled()
  })

  it('a slow release before half way snaps back without committing', () => {
    const c = make()
    c.pointerDown('br', { x: 1, y: 1.4 })
    c.pointerMove({ x: 0.4, y: 1.4 }, -0.2) // progress 0.3
    expect(c.tick(t)).toMatchObject({ phase: 'dragging', dir: 1, corner: 'br' })
    c.pointerUp()
    expect(c.tick(t)).toMatchObject({ phase: 'animating', to: 'cancel' })
    t = 2000
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).not.toHaveBeenCalled()
  })

  it('a release past half way completes the turn', () => {
    const c = make()
    c.pointerDown('br', { x: 1, y: 1.4 })
    c.pointerMove({ x: -0.4, y: 1.4 }, 0) // progress 0.7
    c.pointerUp()
    expect(c.tick(t)).toMatchObject({ phase: 'animating', to: 'complete' })
    t = 2000
    expect(c.tick(t).phase).toBe('idle')
    expect(commit).toHaveBeenCalledWith(1)
  })

  it('a fast leftward flick completes even before half way', () => {
    const c = make()
    c.pointerDown('br', { x: 1, y: 1.4 })
    c.pointerMove({ x: 0.6, y: 1.4 }, -3) // progress 0.2, flicking toward the spine
    c.pointerUp()
    expect(c.tick(t)).toMatchObject({ phase: 'animating', to: 'complete' })
  })

  it('left-page corners turn backwards', () => {
    const c = make()
    c.pointerDown('bl', { x: 0, y: 1.4 })
    expect(c.tick(t)).toMatchObject({ phase: 'dragging', dir: -1 })
  })
})

describe('TurnController onTurnStart', () => {
  it('fires as a completing turn starts (for the page sound), not for a snap-back', () => {
    const onTurnStart = vi.fn()
    const c = new TurnController({ canTurn: () => true, commit, now, onTurnStart })
    c.turn(1)
    expect(onTurnStart).toHaveBeenCalledWith(1)
    t = 700
    c.tick(t)
    c.pointerDown('br', { x: 1, y: 1.4 })
    c.pointerMove({ x: 0.4, y: 1.4 }, -0.2)
    c.pointerUp() // slow and short: snaps back
    expect(onTurnStart).toHaveBeenCalledTimes(1)
  })
})
