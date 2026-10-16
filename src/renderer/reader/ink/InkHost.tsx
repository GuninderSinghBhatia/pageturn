import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useInkInput } from './inkInput'
import { useInkStore } from './inkStore'
import { InkToolbar } from './InkToolbar'
import toolbar from './Ink.module.css'

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

  return mode.active ? (
    <InkToolbar>
      <button
        className={toolbar.btn}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={() => useInkStore.getState().undo()}
      >
        ↶
      </button>
      <button
        className={toolbar.btn}
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        onClick={() => useInkStore.getState().redo()}
      >
        ↷
      </button>
      {children}
    </InkToolbar>
  ) : null
}
