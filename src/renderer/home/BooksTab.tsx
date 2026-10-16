import { useEffect, useMemo, useState } from 'react'
import type { Book } from '@shared/types'
import { displayTitle } from '../library/displayTitle'
import { RemoveDialog } from '../library/RemoveDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { BookSlider } from './BookSlider'
import { SelectedBook } from './SelectedBook'
import styles from './Home.module.css'
import slider from './Slider.module.css'

type Menu = { bookId: string; x: number; y: number } | null

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

/** Every book in a cover slider, filtered by the top bar's search. Drop PDFs anywhere to add. */
export function BooksTab({ query, onAdd }: { query: string; onAdd(): void }): React.JSX.Element {
  const { books, refresh, importPaths, openBook, setLiked } = useLibraryStore()
  const [menu, setMenu] = useState<Menu>(null)
  const [dragging, setDragging] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return books
    return books.filter(
      (b) => displayTitle(b).toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q)
    )
  }, [books, query])

  // Focus is kept by book id so it survives refreshes and filtering.
  const focus = Math.max(
    0,
    visible.findIndex((b) => b.id === focusId)
  )
  const focused: Book | undefined = visible[focus]
  const focusAt = (i: number): void => {
    const b = visible[Math.min(visible.length - 1, Math.max(0, i))]
    if (b) setFocusId(b.id)
  }

  const relocate = async (id: string): Promise<void> => {
    if (await window.api.library.relocate(id)) await refresh()
  }
  const open = (b: Book): void => (b.missing ? void relocate(b.id) : openBook(b.id))

  // ← → Home End move through the slider; Enter opens the focused book.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      const idx = Math.max(
        0,
        visible.findIndex((b) => b.id === focusId)
      )
      const go = (i: number): void => {
        const b = visible[Math.min(visible.length - 1, Math.max(0, i))]
        if (b) setFocusId(b.id)
      }
      if (e.key === 'ArrowRight') go(idx + 1)
      else if (e.key === 'ArrowLeft') go(idx - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(visible.length - 1)
      else if (e.key === 'Enter' && visible[idx] && !(e.target instanceof HTMLButtonElement)) {
        const b = visible[idx]
        if (b.missing) void window.api.library.relocate(b.id)
        else openBook(b.id)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, focusId, openBook])

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
      ) : !focused ? (
        <p className={styles.muted}>No books match “{query}”.</p>
      ) : (
        <div className={slider.stage}>
          {/* Soft glow of the focused cover behind the slider; cross-fades on change. */}
          {focused.thumbnailUrl && (
            <div
              key={focused.id}
              className={slider.ambient}
              style={{ backgroundImage: `url(${focused.thumbnailUrl})` }}
              aria-hidden="true"
            />
          )}
          <BookSlider
            books={visible}
            focus={focus}
            onFocus={focusAt}
            onOpen={open}
            onContextMenu={(b, e) => {
              e.preventDefault()
              setMenu({ bookId: b.id, x: e.clientX, y: e.clientY })
            }}
          />
          <SelectedBook
            book={focused}
            canPrev={focus > 0}
            canNext={focus < visible.length - 1}
            onPrev={() => focusAt(focus - 1)}
            onNext={() => focusAt(focus + 1)}
            onOpen={() => open(focused)}
            onLike={(liked) => setLiked(focused.id, liked)}
            onRelocate={() => void relocate(focused.id)}
            onRemove={() => setRemoving(focused.id)}
          />
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
