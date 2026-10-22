import { useEffect } from 'react'
import { useNav } from '../app/nav'
import { installShortcuts } from '../app/shortcuts'
import { useReaderStore } from '../stores/readerStore'

type Handlers = {
  onFind(): void
  onFocusPageBox(): void
  onEscape(): boolean // true if it closed or left something
  onToggleToolbar(): void
  onHighlight(): boolean // highlight the current text selection; false if there is none
  onBookmark(): void
  onNote(): boolean // note on the selection; false if none
  onAsk(): boolean // Help panel (Explain / Web) for the selection; false if none
  onNotebook(): void
  onTogglePen(): void
  onEraser(): void
  onUndo(): boolean // false when there was nothing to undo
  onRedo(): boolean
}

const ZOOM_STEP = 1.25

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
}

/** Reader keyboard shortcuts (immersive reader spec §7). */
export function useReaderKeys({
  onFind,
  onFocusPageBox,
  onEscape,
  onToggleToolbar,
  onHighlight,
  onBookmark,
  onNote,
  onAsk,
  onNotebook,
  onTogglePen,
  onEraser,
  onUndo,
  onRedo
}: Handlers): void {
  useEffect(() => {
    const store = useReaderStore.getState
    const turn = (dir: 1 | -1) => (): boolean => {
      if (store().zoom > 1) return false // zoomed in: keys scroll/pan instead
      store().requestTurn(dir)
      return true
    }
    const zoom = (f: number) => (): void => store().setZoom(f === 0 ? 1 : store().zoom * f)
    const both = (k: string, fn: () => void | boolean): Record<string, () => void | boolean> => ({
      [k]: fn,
      [`Shift+${k}`]: fn
    })
    // One table for every reader shortcut (immersive reader spec §7, plan 4 §shortcuts).
    return installShortcuts(
      {
        'Ctrl+f': onFind,
        'Ctrl+g': onFocusPageBox,
        'Ctrl+e': onAsk, // Help panel for the selection
        'Ctrl+b': onNotebook,
        'Ctrl+d': onBookmark,
        'Ctrl+z': onUndo,
        'Ctrl+y': onRedo,
        'Ctrl+Shift+z': onRedo,
        'Ctrl+=': zoom(ZOOM_STEP),
        'Ctrl++': zoom(ZOOM_STEP),
        'Ctrl+Shift++': zoom(ZOOM_STEP),
        'Ctrl+-': zoom(1 / ZOOM_STEP),
        'Ctrl+0': zoom(0),
        // Innermost first: cards and tools, then the toolbar, then fullscreen.
        Escape: () => {
          if (!onEscape() && document.fullscreenElement) void document.exitFullscreen()
          return false
        },
        F11: toggleFullscreen, // focus mode: fullscreen, toolbar only at the top edge
        ArrowRight: turn(1),
        PageDown: turn(1),
        Space: turn(1),
        'Shift+Space': turn(-1),
        ArrowLeft: turn(-1),
        PageUp: turn(-1),
        Home: () => store().goTo(1),
        End: () => store().goTo(store().doc!.numPages),
        ...both('h', onHighlight),
        ...both('p', onTogglePen),
        ...both('e', onEraser),
        ...both('t', onToggleToolbar),
        ...both('b', onBookmark),
        ...both('n', onNote),
        ...both('a', onAsk)
      },
      () => !!store().doc && !useNav.getState().settingsOpen,
      // Typing a note or a search: only these reach the reader (find, go to page, help, notebook).
      new Set(['Ctrl+f', 'Ctrl+g', 'Ctrl+e', 'Ctrl+b'])
    )
  }, [
    onFind,
    onFocusPageBox,
    onEscape,
    onToggleToolbar,
    onHighlight,
    onBookmark,
    onNote,
    onAsk,
    onNotebook,
    onTogglePen,
    onEraser,
    onUndo,
    onRedo
  ])
}
