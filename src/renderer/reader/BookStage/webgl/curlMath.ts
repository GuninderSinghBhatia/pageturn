/**
 * Cylinder page-curl geometry. Page-local units: the turning page spans x∈[0,1], y∈[0,aspect]
 * with y pointing down (tl = (0,0), br = (1,aspect)). Right-page corners (tr/br) turn over the
 * spine at x=0 and end mirrored at x=-1; left-page corners (tl/bl) turn over x=1 and end at x=2.
 * The vertex shader (shaders.ts) mirrors `curlVertex` exactly.
 */
export type Corner = 'tr' | 'br' | 'tl' | 'bl'
export type Vec2 = { x: number; y: number }
export type Fold = {
  origin: Vec2
  dir: Vec2 // unit, along the fold line
  normal: Vec2 // unit, toward the lifted side
  radius: number
}

const MIN_DRAG = 1e-6

export function cornerPos(corner: Corner, aspect: number): Vec2 {
  return { x: corner[1] === 'r' ? 1 : 0, y: corner[0] === 'b' ? aspect : 0 }
}

export function mirroredCorner(corner: Corner, aspect: number): Vec2 {
  const c = cornerPos(corner, aspect)
  return { x: c.x === 1 ? -1 : 2, y: c.y }
}

/** 0 with the pointer on the corner, 1 at the mirrored position (by horizontal travel). */
export function progressFromPointer(corner: Corner, pointer: Vec2): number {
  const cx = corner[1] === 'r' ? 1 : 0
  const mx = cx === 1 ? -1 : 2
  const p = (pointer.x - cx) / (mx - cx)
  return Math.min(1, Math.max(0, p))
}

/** Fold = perpendicular bisector of corner→pointer; radius shrinks as the turn progresses. */
export function foldFromDrag(
  corner: Corner,
  pointer: Vec2,
  aspect: number,
  baseRadius = 0.06
): Fold {
  const c = cornerPos(corner, aspect)
  const progress = progressFromPointer(corner, pointer)
  const radius = baseRadius * (1 - 0.7 * progress)
  let nx = c.x - pointer.x
  let ny = c.y - pointer.y
  const len = Math.hypot(nx, ny)
  if (len < MIN_DRAG) {
    // Pointer on the corner: a fold through the corner that curls nothing.
    const away = c.x === 1 ? 1 : -1
    return { origin: c, dir: { x: 0, y: 1 }, normal: { x: away, y: 0 }, radius }
  }
  nx /= len
  ny /= len
  return {
    origin: { x: (c.x + pointer.x) / 2, y: (c.y + pointer.y) / 2 },
    dir: { x: -ny, y: nx },
    normal: { x: nx, y: ny },
    radius
  }
}

/** Wraps a flat page point around the fold cylinder (z toward the viewer). */
export function curlVertex(
  p: Vec2,
  fold: Fold
): { pos: [number, number, number]; normal: [number, number, number]; back: boolean } {
  const { origin, normal: n, radius: r } = fold
  const d = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y
  if (d <= 0) return { pos: [p.x, p.y, 0], normal: [0, 0, 1], back: false }
  const proj = { x: p.x - n.x * d, y: p.y - n.y * d }
  const halfCirc = Math.PI * r
  if (d <= halfCirc) {
    const theta = d / r
    const s = Math.sin(theta)
    const c = Math.cos(theta)
    return {
      pos: [proj.x + n.x * r * s, proj.y + n.y * r * s, r * (1 - c)],
      normal: [-n.x * s, -n.y * s, c],
      back: theta > Math.PI / 2 + 1e-9 // epsilon: d = πr/2 must count as front-facing
    }
  }
  const over = d - halfCirc
  return { pos: [proj.x - n.x * over, proj.y - n.y * over, 2 * r], normal: [0, 0, -1], back: true }
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Pointer path for click/key turns: eased arc from the corner to its mirror, lifted mid-way. */
export function scriptedPath(corner: Corner, t: number, aspect: number): Vec2 {
  const e = easeInOutCubic(Math.min(1, Math.max(0, t)))
  const c = cornerPos(corner, aspect)
  const m = mirroredCorner(corner, aspect)
  const lift = 0.15 * aspect * Math.sin(Math.PI * e) * (corner[0] === 'b' ? -1 : 1)
  return { x: c.x + (m.x - c.x) * e, y: c.y + lift }
}

/**
 * Whether a released drag completes the turn. `velocityX` is the pointer's screen-x velocity in
 * page-widths/s; `dir` is the screen-x direction in which the turn completes (-1 = leftwards).
 */
export function shouldComplete(progress: number, velocityX: number, dir: 1 | -1): boolean {
  return progress > 0.5 || velocityX * dir > 1.5
}
