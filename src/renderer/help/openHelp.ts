import { displayTitle } from '../library/displayTitle'
import { hasTextSelection, selectionByPage } from '../reader/annotations/selection'
import { useLibraryStore } from '../stores/libraryStore'
import { useReaderStore } from '../stores/readerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { buildExplainRequest } from './buildContext'
import { useHelpStore, type HelpSelection } from './helpStore'

/**
 * Opens the Help panel for the current text selection (Ctrl+E, A, or "Ask AI" in the
 * selection menu). A selection across both pages of a spread keeps both, joined by a space.
 * Returns false (and says so) when nothing is selected.
 */
export function openHelp(root: HTMLElement | null): boolean {
  const sel = window.getSelection()
  const pieces = sel && root && hasTextSelection(root) ? selectionByPage(sel, root) : []
  const { doc, bookId } = useReaderStore.getState()
  if (pieces.length === 0 || !doc) {
    useToastStore.getState().show('Select some text first')
    return false
  }
  const selection: HelpSelection = {
    text: pieces
      .map((p) => p.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' '),
    pages: pieces.map((p) => p.page),
    rects: Object.fromEntries(pieces.map((p) => [p.page, p.rects]))
  }
  const book = useLibraryStore.getState().books.find((b) => b.id === bookId)
  const title = book ? displayTitle(book) : null
  const { settings } = useSettingsStore.getState()
  void window.api.settings.hasApiKey(settings.aiProvider).then((hasKey) =>
    useHelpStore.getState().openFor(selection, {
      hasKey,
      defaultTab: settings.helpDefaultTab,
      privacyAcknowledged: settings.aiPrivacyAcknowledged,
      buildRequest: () => buildExplainRequest(doc, selection, title)
    })
  )
  return true
}
