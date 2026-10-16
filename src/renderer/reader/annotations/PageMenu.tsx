import { useEffect, type RefObject } from 'react'
import { pageAt } from './pageAt'
import { useOverlayUi } from './uiStore'
import styles from './Annotations.module.css'

/** Right-click on a page → "Add note here". Listens on the reader viewport. */
export function PageMenu({
  rootRef
}: {
  rootRef: RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const menu = useOverlayUi((s) => s.menu)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onContext = (e: MouseEvent): void => {
      const hit = pageAt(root, e.clientX, e.clientY)
      if (!hit) return
      e.preventDefault()
      useOverlayUi.getState().showMenu({ clientX: e.clientX, clientY: e.clientY, ...hit })
    }
    root.addEventListener('contextmenu', onContext)
    return () => root.removeEventListener('contextmenu', onContext)
  }, [rootRef])

  useEffect(() => {
    if (!menu) return
    const close = (e: Event): void => {
      if (!(e.target instanceof Element && e.target.closest('[role="menu"]'))) {
        useOverlayUi.getState().showMenu(null)
      }
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useOverlayUi.getState().showMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  if (!menu) return null
  return (
    <div
      className={styles.menu}
      role="menu"
      data-no-turn
      style={{ left: menu.clientX, top: menu.clientY }}
    >
      <button
        role="menuitem"
        onClick={() => useOverlayUi.getState().openNoteAt({ page: menu.page, point: menu.point })}
      >
        Add note here
      </button>
    </div>
  )
}
