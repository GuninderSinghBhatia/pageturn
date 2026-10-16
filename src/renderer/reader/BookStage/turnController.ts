import {
  cornerPos,
  mirroredCorner,
  progressFromPointer,
  scriptedPath,
  shouldComplete,
  type Corner,
  type Vec2
} from './webgl/curlMath'

export type TurnDir = 1 | -1
export type TurnState =
  | { phase: 'idle' }
  | { phase: 'dragging'; dir: TurnDir; corner: Corner; pointer: Vec2 }
  | {
      phase: 'animating'
      dir: TurnDir
      corner: Corner
      from: Vec2
      to: 'complete' | 'cancel'
      t: number // 0..1
      scripted: boolean // click/key turn following scriptedPath
    }

type Options = {
  canTurn: (dir: TurnDir) => boolean
  commit: (dir: TurnDir) => void
  durationMs?: number
  now?: () => number
}

const MIN_RELEASE_MS = 120

export const dirForCorner = (corner: Corner): TurnDir => (corner[1] === 'r' ? 1 : -1)

/**
 * Page-turn state machine. The reader's page index changes only via `commit`, at the end of a
 * completed animation (or when a new turn snaps the running one to completion), so the index
 * never runs ahead of what is displayed.
 */
export class TurnController {
  private state: TurnState = { phase: 'idle' }
  private startedAt = 0
  private duration = 0
  private velocityX = 0
  private readonly durationMs: number
  private readonly now: () => number

  constructor(private opts: Options) {
    this.durationMs = opts.durationMs ?? 600
    this.now = opts.now ?? (() => performance.now())
  }

  get current(): TurnState {
    return this.state
  }

  /** Click/key turn. A running turn is finished (and committed) first; queue depth is 1. */
  turn(dir: TurnDir): void {
    if (this.state.phase === 'dragging') return
    if (this.state.phase === 'animating') this.finish()
    if (!this.opts.canTurn(dir)) return
    const corner: Corner = dir === 1 ? 'br' : 'bl'
    this.startAnimation(dir, corner, cornerPos(corner, 1), 'complete', this.durationMs, true)
  }

  pointerDown(corner: Corner, p: Vec2): void {
    if (this.state.phase === 'animating') this.finish()
    const dir = dirForCorner(corner)
    if (this.state.phase !== 'idle' || !this.opts.canTurn(dir)) return
    this.velocityX = 0
    this.state = { phase: 'dragging', dir, corner, pointer: p }
  }

  pointerMove(p: Vec2, velocityX: number): void {
    if (this.state.phase !== 'dragging') return
    this.velocityX = velocityX
    this.state = { ...this.state, pointer: p }
  }

  pointerUp(): void {
    if (this.state.phase !== 'dragging') return
    const { dir, corner, pointer } = this.state
    const progress = progressFromPointer(corner, pointer)
    // A forward (dir 1) turn completes by moving left on screen.
    const complete = shouldComplete(progress, this.velocityX, dir === 1 ? -1 : 1)
    const remaining = complete ? 1 - progress : progress
    const ms = Math.max(MIN_RELEASE_MS, this.durationMs * remaining)
    this.startAnimation(dir, corner, pointer, complete ? 'complete' : 'cancel', ms, false)
  }

  /** Abandons a drag or animation without committing (e.g. the stage unmounts). */
  reset(): void {
    this.state = { phase: 'idle' }
  }

  tick(now: number): TurnState {
    if (this.state.phase !== 'animating') return this.state
    const t = Math.min(1, (now - this.startedAt) / this.duration)
    if (t >= 1) this.finish()
    else this.state = { ...this.state, t }
    return this.state
  }

  private startAnimation(
    dir: TurnDir,
    corner: Corner,
    from: Vec2,
    to: 'complete' | 'cancel',
    ms: number,
    scripted: boolean
  ): void {
    this.startedAt = this.now()
    this.duration = ms
    this.state = { phase: 'animating', dir, corner, from, to, t: 0, scripted }
  }

  private finish(): void {
    const s = this.state
    this.state = { phase: 'idle' }
    if (s.phase === 'animating' && s.to === 'complete') this.opts.commit(s.dir)
  }
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/** Pointer (page-local units) to draw for a turn state, or null when nothing is curling. */
export function turnPointer(state: TurnState, aspect: number): Vec2 | null {
  if (state.phase === 'idle') return null
  if (state.phase === 'dragging') return state.pointer
  if (state.scripted) return scriptedPath(state.corner, state.t, aspect)
  const target =
    state.to === 'complete' ? mirroredCorner(state.corner, aspect) : cornerPos(state.corner, aspect)
  const e = easeOutCubic(state.t)
  return {
    x: state.from.x + (target.x - state.from.x) * e,
    y: state.from.y + (target.y - state.from.y) * e
  }
}
