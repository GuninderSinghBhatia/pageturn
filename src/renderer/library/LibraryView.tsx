import { useEffect, useMemo, useState } from 'react'
import { useNav } from '../app/nav'
import { useLibraryStore } from '../stores/libraryStore'
import { BookCard } from './BookCard'
import { displayTitle } from './displayTitle'
import styles from './LibraryView.module.css'
import { RemoveDialog } from './RemoveDialog'

type Sort = 'recent' | 'title'
type Menu = { bookId: string; x: number; y: number } | null

export function LibraryView(): React.JSX.Element {
  const { books, refresh, importPaths, openBook } = useLibraryStore()
  const openSettings = useNav((s) => s.openSettings)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [menu, setMenu] = useState<Menu>(null)
  const [dragging, setDragging] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
    return window.api.library.onChanged(() => void refresh())
  }, [refresh])

  // Window-wide drop zone for PDFs.
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent): void => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.api.library.pathForFile(f))
      void importPaths(paths)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [importPaths])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? books.filter((b) => displayTitle(b).toLowerCase().includes(q)) : [...books]
    if (sort === 'title') {
      list.sort((a, b) =>
        displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' })
      )
    }
    return list
  }, [books, query, sort])

  const relocate = async (id: string): Promise<void> => {
    if (await window.api.library.relocate(id)) await refresh()
  }

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <h1 className={styles.brand}>PageTurn</h1>
        <input
          className={styles.search}
          type="search"
          placeholder="Search titles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className={styles.sortLabel}>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recent</option>
            <option value="title">Title</option>
          </select>
        </label>
        <button
          className={styles.primary}
          onClick={async () => {
            if ((await window.api.library.openDialog()).length) await refresh()
          }}
        >
          Open PDF
        </button>
        <button
          className={styles.iconBtn}
          onClick={openSettings}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>

      {books.length === 0 ? (
        <div className={styles.empty}>
          <p>Your library is empty.</p>
          <p>Drop PDF files here, or use “Open PDF”.</p>
        </div>
      ) : (
        <main className={styles.grid}>
          {visible.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              onOpen={() => openBook(b.id)}
              onRelocate={() => void relocate(b.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ bookId: b.id, x: e.clientX, y: e.clientY })
              }}
            />
          ))}
        </main>
      )}

      {menu && (
        <div className={styles.menu} style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setRemoving(menu.bookId)
              setMenu(null)
            }}
          >
            Remove from library
          </button>
        </div>
      )}

      {removing && (
        <RemoveDialog
          title={(() => {
            const b = books.find((x) => x.id === removing)
            return b ? displayTitle(b) : 'this book'
          })()}
          onCancel={() => setRemoving(null)}
          onConfirm={async (deleteAnnotations) => {
            const id = removing
            setRemoving(null)
            await window.api.library.remove(id, deleteAnnotations)
            await refresh()
          }}
        />
      )}
      {dragging && <div className={styles.dropOverlay}>Drop PDFs to add them</div>}
    </div>
  )
}
