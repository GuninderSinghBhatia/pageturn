import { useEffect, useMemo, useState } from 'react'
import { displayTitle } from '../library/displayTitle'
import { RemoveDialog } from '../library/RemoveDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { BookCard } from './BookCard'
import styles from './Home.module.css'

type Menu = { bookId: string; x: number; y: number } | null

/** Every book as a card grid; filtered by the top bar's search. Drop PDFs anywhere to add. */
export function BooksTab({ query, onAdd }: { query: string; onAdd(): void }): React.JSX.Element {
  const { books, refresh, importPaths, openBook, setLiked } = useLibraryStore()
  const [menu, setMenu] = useState<Menu>(null)
  const [dragging, setDragging] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

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
    if (!q) return books
    return books.filter(
      (b) => displayTitle(b).toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q)
    )
  }, [books, query])

  const relocate = async (id: string): Promise<void> => {
    if (await window.api.library.relocate(id)) await refresh()
  }
  const removingBook = books.find((b) => b.id === removing)

  return (
    <>
      {books.length === 0 ? (
        <div className={styles.emptyCard}>
          <h2>Your library is empty</h2>
          <p>Add PDFs to start reading, or drop them anywhere in this window.</p>
          <button className={styles.primary} onClick={onAdd}>
            Add books
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className={styles.muted}>No books match “{query}”.</p>
      ) : (
        <div className={styles.grid}>
          {visible.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              onOpen={() => openBook(b.id)}
              onRelocate={() => void relocate(b.id)}
              onLike={(liked) => setLiked(b.id, liked)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ bookId: b.id, x: e.clientX, y: e.clientY })
              }}
            />
          ))}
        </div>
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
          title={removingBook ? displayTitle(removingBook) : 'this book'}
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
    </>
  )
}
