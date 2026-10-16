/**
 * Page-flip geometry: the turning page swings around the spine like a leaf of a real book.
 *
 * A point `xs` (distance from the spine along the paper, 0..1 page widths) on a page turned by
 * `progress` (0 = flat where it started, 1 = flat on the other side) sits on an arc whose angle
 * grows along the paper: φ(s) = θ + c·s, with θ = π·progress and c = BEND·sin(π·progress). The
 * outer edge therefore leads mid-turn (paper pulled from the edge), the paper is never
 * stretched, and the page lies flat at both ends. `x` is measured from the spine towards the
 * page's own side (negative = past the spine), `z` towards the reader. The vertex shader
 * (shaders.ts, mode flip) mirrors this exactly.
 */
export const BEND = 0.9 // radians of extra lead at the outer edge mid-turn

export function flipPoint(xs: number, progress: number): { x: number; z: number; back: boolean } {
  if (progress <= 0) return { x: xs, z: 0, back: false }
  const theta = Math.PI * progress
  const c = progress >= 1 ? 0 : BEND * Math.sin(theta)
  const phi = theta + c * xs
  let x: number
  let z: number
  if (Math.abs(c) < 1e-6) {
    x = xs * Math.cos(theta)
    z = xs * Math.sin(theta)
  } else {
    x = (Math.sin(phi) - Math.sin(theta)) / c
    z = (Math.cos(theta) - Math.cos(phi)) / c
  }
  if (Math.abs(z) < 1e-12) z = 0
  return { x, z, back: Math.cos(phi) < 0 }
}

/**
 * Shadow strengths on the flat pages during a flip: `under` darkens the page being uncovered
 * (strong early, while the leaf hangs over it), `landing` the page it falls onto (strong late).
 */
export function flipShadows(progress: number): { under: number; landing: number } {
  if (progress <= 0 || progress >= 1) return { under: 0, landing: 0 }
  const lift = Math.sin(Math.PI * progress)
  return { under: 0.5 * lift * (1 - progress), landing: 0.5 * lift * progress }
}
