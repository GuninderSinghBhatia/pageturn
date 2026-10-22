import { useEffect, useState } from 'react'
import { useNav } from '../../app/nav'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useReaderStore } from '../../stores/readerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { spreadFor, spreadPages } from '../layout'
import type { OpenedDoc } from '../pdf/pdfService'
import { bookmarkTabs } from './tabList'
import styles from './Annotations.module.css'

type Menu = { page: number; renaming: boolean } | null

/**
 * Physical-looking ribbon tabs sticking out of the right page edge: a grey settings tab, then
 * one numbered pastel tab per bookmark. Click jumps; right-click renames or deletes.
 */
export function BookmarkTabs({ doc }: { doc: OpenedDoc }): React.JSX.Element {
  const bookmarks = useAnnotationStore((s) => s.bookmarks)
  const show = useSettingsStore((s) => s.settings.showBookmarkTabs)
  const visible = useReaderStore((s) =>
    s.doc ? spreadPages(spreadFor(s.page, s.doc.numPages, s.layout)).join(',') : ''
  )
  // Zoomed in, the page edge is off-screen or moving: the tabs fade out instead of jumping.
  const zoomed = useReaderStore((s) => s.zoom > 1)
  const [menu, setMenu] = useState<Menu>(null)
  const [snippets, setSnippets] = useState<Record<number, string>>({})
  const tabs = show ? bookmarkTabs(bookmarks) : []

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('[data-tab-menu]'))) setMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [menu])

  // Hover tooltip shows the page's first words; fetched on first hover.
  const loadSnippet = (page: number): void => {
    if (snippets[page] !== undefined) return
    void doc.getText(page).then((items) => {
      const words = items
        .map((t) => t.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      setSnippets((s) => ({ ...s, [page]: words.slice(0, 60) }))
    })
  }

  return (
    <div className={`${styles.tabs} ${zoomed ? styles.tabsAway : ''}`} data-no-turn>
      <button
        className={`${styles.tab} ${styles.gearTab}`}
        aria-label="Settings tab"
        title="Settings"
        onClick={useNav.getState().openSettings}
      >
        ⚙
      </button>
      {tabs.map((t) => (
        <div key={t.page} className={styles.tabSlot}>
          <button
            className={`${styles.tab} ${visible.split(',').includes(String(t.page)) ? styles.tabHere : ''}`}
            style={{ background: t.color }}
            aria-label={`Bookmark ${t.index}, page ${t.page}${t.label ? `: ${t.label}` : ''}`}
            title={`p. ${t.page} — ${t.label ?? snippets[t.page] ?? ''}`}
            onMouseEnter={() => loadSnippet(t.page)}
            onClick={() => useReaderStore.getState().goTo(t.page)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ page: t.page, renaming: false })
            }}
          >
            {t.index}
          </button>
          {menu?.page === t.page && (
            <div className={styles.tabMenu} role="menu" data-tab-menu>
              {menu.renaming ? (
                <input
                  className={styles.tabRename}
                  aria-label="Bookmark name"
                  autoFocus
                  defaultValue={t.label ?? ''}
                  maxLength={200}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = e.currentTarget.value.trim()
                      useAnnotationStore.getState().renameBookmark(t.page, v || null)
                      setMenu(null)
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setMenu(null)
                    }
                  }}
                />
              ) : (
                <>
                  <button role="menuitem" onClick={() => setMenu({ page: t.page, renaming: true })}>
                    Rename
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      useAnnotationStore.getState().toggleBookmark(t.page)
                      setMenu(null)
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
