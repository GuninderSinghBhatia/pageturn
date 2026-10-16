import {
  nextSpreadStart,
  prevSpreadStart,
  spreadFor,
  type ResolvedLayout,
  type Spread
} from '../layout'
import type { TurnState } from './turnController'
import type { PageTextures } from './webgl/renderer'

/**
 * Which page bitmap goes where for the current turn state: the static spread when idle; the
 * turning leaf (front/back) and the pages it uncovers when a turn is under way.
 */
export function stageTextures(
  state: TurnState,
  cur: Spread,
  layout: ResolvedLayout,
  numPages: number,
  pick: (page: number) => ImageBitmap | undefined
): PageTextures {
  const b = (p: number | null | undefined): ImageBitmap | undefined =>
    p == null ? undefined : pick(p)
  const single = layout === 'single'
  if (state.phase === 'idle') return { staticLeft: b(cur.left), staticRight: b(cur.right) }
  const start = cur.left ?? cur.right!
  if (state.dir === 1) {
    const to = spreadFor(nextSpreadStart(start, numPages, layout) ?? start, numPages, layout)
    return single
      ? { front: b(cur.right), rightUnder: b(to.right) }
      : { staticLeft: b(cur.left), front: b(cur.right), rightUnder: b(to.right), back: b(to.left) }
  }
  const to = spreadFor(prevSpreadStart(start, numPages, layout) ?? start, numPages, layout)
  return single
    ? { front: b(cur.right), leftUnder: b(to.right) }
    : { staticRight: b(cur.right), front: b(cur.left), leftUnder: b(to.left), back: b(to.right) }
}
