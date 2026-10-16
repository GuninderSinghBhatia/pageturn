import { useEffect, type RefObject } from 'react'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useInkInput } from './inkInput'
import { useInkStore } from './inkStore'
import { InkToolbar } from './InkToolbar'

type Props = { viewportRef: RefObject<HTMLElement | null>; children?: React.ReactNode }

/** Pen input for the reader viewport, plus the toolbar while pen mode is on. */
export function InkHost({ viewportRef, children }: Props): React.JSX.Element | null {
  const mode = useInkStore((s) => s.mode)
  const { drawWithMouse, penColor, penWidth } = useSettingsStore((s) => s.settings)

  // Defaults from Settings; toolbar changes last for the session.
  useEffect(
    () => useInkStore.getState().setMode({ color: penColor, width: penWidth }),
    [penColor, penWidth]
  )
  // Leaving the book leaves pen mode.
  useEffect(
    () => () => useInkStore.setState((s) => ({ mode: { ...s.mode, active: false }, live: null })),
    []
  )

  useInkInput({
    viewportRef,
    mode,
    drawWithMouse,
    onLive: (page, stroke) => useInkStore.getState().setLive(stroke && { page, stroke }),
    onCommit: (page, s) =>
      useAnnotationStore
        .getState()
        .addInk([{ page, points: s.points, color: s.color, width: s.width, tool: s.tool }]),
    onErase: () => undefined // Task 10
  })

  return mode.active ? <InkToolbar>{children}</InkToolbar> : null
}
