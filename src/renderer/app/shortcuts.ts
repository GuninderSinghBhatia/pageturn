/** A key → handler table. Returning false means "not handled" (the key is not prevented). */
export type ShortcutMap = Record<string, () => void | boolean>

/** "Ctrl+Shift+g", "ArrowRight", "p", "Space", "F11" (Cmd counts as Ctrl). */
export function normalizeKey(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey && (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1)) mods.push('Shift')
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key
  return [...mods, k].join('+')
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute?.('contenteditable') === 'true'
  )
}

/** Shortcuts that belong to the text field while one is focused (undo, copy, select all…). */
const TEXT_EDITING = new Set([
  'Ctrl+z',
  'Ctrl+y',
  'Ctrl+Shift+z',
  'Ctrl+a',
  'Ctrl+c',
  'Ctrl+v',
  'Ctrl+x'
])

/**
 * Installs one keydown listener for a table of shortcuts. While typing in a field, plain
 * keys (letters, Space, arrows…) are left to the field; F-keys and Esc still work, and so do
 * Ctrl combinations (except the text-editing ones above), or only those in `whileTyping`.
 */
export function installShortcuts(
  map: ShortcutMap,
  enabled: () => boolean = () => true,
  whileTyping?: Set<string>
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (!enabled()) return
    const k = normalizeKey(e)
    const fn = map[k]
    if (!fn) return
    if (isTypingTarget(e.target)) {
      const always =
        /^F\d+$/.test(e.key) ||
        e.key === 'Escape' ||
        (k.startsWith('Ctrl+') && (whileTyping ? whileTyping.has(k) : !TEXT_EDITING.has(k)))
      if (!always) return
    }
    if (fn() !== false) e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
