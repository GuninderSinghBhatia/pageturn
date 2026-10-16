import { create } from 'zustand'
import type { HighlightStyle } from '@shared/types'
import { useInkStore } from '../ink/inkStore'
import { ToolbarReveal } from './reveal'

export type Panel = 'search' | 'contents' | 'display' | null
/** Text tools apply to a selection as soon as it is made. */
export type TextTool =
  | { kind: 'highlight' }
  | { kind: 'underline'; style: Extract<HighlightStyle, 'underline' | 'wavy'> }

type ChromeState = {
  visible: boolean
  panel: Panel
  textTool: TextTool | null
  /** Focus target requested when the toolbar opens (Ctrl+G). */
  focusPageBox: number
  setPanel(p: Panel): void
  setTextTool(t: TextTool | null): void
  toggleToolbar(): void
  openWith(panel: Panel): void
  openPageBox(): void
  /** Esc: closes a panel, else leaves the active tool, else hides the toolbar. False if idle. */
  escape(): boolean
}

let reveal: ToolbarReveal

export const useChromeStore = create<ChromeState>((set, get) => {
  reveal = new ToolbarReveal((visible) => set(visible ? { visible } : { visible, panel: null }))
  return {
    visible: false,
    panel: null,
    textTool: null,
    focusPageBox: 0,
    setPanel: (panel) => set({ panel }),
    setTextTool: (textTool) => {
      if (textTool) useInkStore.getState().setMode({ active: false })
      set({ textTool })
    },
    toggleToolbar: () => reveal.toggle(),
    openWith: (panel) => {
      if (!reveal.visible) reveal.toggle()
      set({ panel })
    },
    openPageBox: () => {
      if (!reveal.visible) reveal.toggle()
      set({ focusPageBox: get().focusPageBox + 1 })
    },
    escape: () => {
      const s = get()
      const ink = useInkStore.getState()
      if (s.panel) set({ panel: null })
      else if (s.textTool || ink.mode.active) {
        set({ textTool: null })
        ink.setMode({ active: false })
      } else if (s.visible) reveal.hide()
      else return false
      return true
    }
  }
})

/** The reveal controller (pointer, pin, focus, idle) behind the store's `visible`. */
export const toolbarReveal = (): ToolbarReveal => {
  useChromeStore.getState() // ensure the store (and controller) exist
  return reveal
}

/** Resets chrome state when a book closes. */
export function resetChrome(): void {
  toolbarReveal().hide()
  useChromeStore.setState({ panel: null, textTool: null })
}
