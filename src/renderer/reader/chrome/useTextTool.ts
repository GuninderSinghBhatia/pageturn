import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { annotateSelection, hasTextSelection } from '../annotations/selection'
import { useChromeStore } from './chromeStore'

/** While the highlighter or underline tool is active, a finished selection is annotated at once. */
export function useTextTool(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const up = (): void => {
      const tool = useChromeStore.getState().textTool
      const root = rootRef.current
      if (!tool || !hasTextSelection(root)) return
      const color = useSettingsStore.getState().settings.highlightColor
      annotateSelection(root, color, tool.kind === 'highlight' ? 'highlight' : tool.style)
    }
    document.addEventListener('pointerup', up)
    return () => document.removeEventListener('pointerup', up)
  }, [rootRef])
}
