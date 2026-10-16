import { effectiveSite, lookupUrl } from '@shared/lookup'
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

/** Ask AI (coming soon) / Wikipedia card for the selected phrase, anchored under it. */
export function showCard(root: HTMLElement | null, kind: CardKind): boolean {
  const sel = window.getSelection()
  if (!sel || !hasTextSelection(root)) return false
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (!text) return false
  const r = sel.getRangeAt(0).getBoundingClientRect()
  useOverlayUi.getState().showCard({ kind, text, x: r.left, y: r.bottom })
  return true
}

/** Look up the selection: a Wikipedia card, or the chosen site opened with the phrase. */
export function lookUp(root: HTMLElement | null): boolean {
  const settings = useSettingsStore.getState().settings
  if (effectiveSite(settings) === 'wikipedia') return showCard(root, 'lookup')
  const text = window.getSelection()?.toString().replace(/s+/g, ' ').trim()
  if (!text || !hasTextSelection(root)) return false
  void window.api.lookup.open(lookupUrl(settings, text.slice(0, 300)), settings.lookupOpenIn)
  return true
}

export function copySelection(): void {
  void navigator.clipboard.writeText(window.getSelection()?.toString() ?? '')
}
