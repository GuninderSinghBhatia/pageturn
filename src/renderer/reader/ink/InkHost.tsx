import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useInkInput } from './inkInput'
import { useInkStore } from './inkStore'

type Props = { viewportRef: RefObject<HTMLElement | null> }

/** Pen input for the reader viewport (options live in the reader toolbar). */
export function InkHost({ viewportRef }: Props): null {
  const mode = useInkStore((s) => s.mode)
  const { drawWithMouse, penColor, penWidth } = useSettingsStore((s) => s.settings)

  // Defaults from Settings; toolbar changes last for the session.
  useEffect(
    () => useInkStore.getState().setMode({ color: penColor, width: penWidth }),
    [penColor, penWidth]
  )
  // Leaving the book leaves pen mode.
  useEffect(
    () => () => {
      useInkStore.setState((s) => ({ mode: { ...s.mode, active: false }, live: null }))
      useInkStore.getState().reset()
    },
    []
  )

  useInkInput({
    viewportRef,
    mode,
    drawWithMouse,
    onLive: (page, stroke) => useInkStore.getState().setLive(stroke && { page, stroke }),
    onCommit: (page, s) =>
      useInkStore
        .getState()
        .commit(page, { page, points: s.points, color: s.color, width: s.width, tool: s.tool }),
    onErase: (page, p, aspect) => useInkStore.getState().eraseAt(page, p, aspect),
    onEraseEnd: (page) => useInkStore.getState().endErase(page)
  })

  return null
}
