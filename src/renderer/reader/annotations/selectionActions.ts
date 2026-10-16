import { useSettingsStore } from '../../stores/settingsStore'
import { annotateSelection, hasTextSelection, highlightSelection } from './selection'
import { useOverlayUi, type CardKind } from './uiStore'

const color = (): ReturnType<typeof useSettingsStore.getState>['settings']['highlightColor'] =>
  useSettingsStore.getState().settings.highlightColor

/** "Make a note": dotted note line on the selection, then its note card opens for typing. */
export function makeNote(root: HTMLElement | null): boolean {
  const [first] = annotateSelection(root, color(), 'note')
  if (!first) return false
  useOverlayUi.getState().openHighlightCard({ id: first.id, editNote: true })
  return true
}

export function highlight(root: HTMLElement | null): boolean {
  return highlightSelection(root, color())
}

/** Ask AI / Look up card for the selected phrase (the services arrive in a later release). */
export function showCard(root: HTMLElement | null, kind: CardKind): boolean {
  const sel = window.getSelection()
  if (!sel || !hasTextSelection(root)) return false
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  const r = sel.getRangeAt(0).getBoundingClientRect()
  useOverlayUi.getState().showCard({ kind, text, x: r.left, y: r.bottom })
  return true
}

export function copySelection(): void {
  void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '')
}
