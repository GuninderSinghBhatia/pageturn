import { useEffect, useRef, useState } from 'react'
import { useNav, type HomeTab } from '../app/nav'
import { SettingsView } from '../settings/SettingsView'
import { useLibraryStore } from '../stores/libraryStore'
import { BooksTab } from './BooksTab'
import { NotesTab } from './NotesTab'
import logo from '../../../build/icon.svg'
import styles from './Home.module.css'

const TABS: { id: HomeTab; label: string }[] = [
  { id: 'books', label: 'Books' },
  { id: 'notes', label: 'Notes' },
  { id: 'online', label: 'Search Online' },
  { id: 'settings', label: 'Settings' }
]

const SearchIcon = (): React.JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

/** The home page: a fixed top bar with four sections, and the active section below. */
export function HomeView(): React.JSX.Element {
  const tab = useNav((s) => s.homeTab)
  const setTab = useNav((s) => s.setHomeTab)
  const refresh = useLibraryStore((s) => s.refresh)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refresh()
    return window.api.library.onChanged(() => void refresh())
  }, [refresh])

  const addBooks = async (): Promise<void> => {
    if ((await window.api.library.openDialog()).length) await refresh()
  }

  return (
    <div className={styles.home}>
      <header className={`${styles.bar} app-drag`}>
        <div className={styles.logo}>
          <img className={styles.logoMark} src={logo} alt="" />
          PageTurn
        </div>
        <nav className={styles.tabs} role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className={styles.barRight}>
          {(tab === 'books' || tab === 'notes') && (
            <div className={`${styles.search} ${searching ? styles.searchOpen : ''}`}>
              {searching && (
                <input
                  ref={searchRef}
                  type="search"
                  aria-label={tab === 'notes' ? 'Filter notes' : 'Filter books'}
                  placeholder={tab === 'notes' ? 'Note, passage or book' : 'Title or author'}
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('')
                      setSearching(false)
                    }
                  }}
                />
              )}
              <button
                className={styles.iconBtn}
                aria-label="Search library"
                aria-pressed={searching}
                onClick={() => {
                  setSearching((s) => !s)
                  if (searching) setQuery('')
                }}
              >
                <SearchIcon />
              </button>
            </div>
          )}
          <button className={styles.secondary} onClick={() => void addBooks()}>
            + Add books
          </button>
        </div>
      </header>

      <main
        className={styles.content}
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === tab)!.label}
      >
        {tab === 'books' && <BooksTab query={query} onAdd={() => void addBooks()} />}
        {tab === 'notes' && <NotesTab query={query} />}
        {tab === 'online' && (
          <div className={styles.online}>
            <input
              className={styles.onlineSearch}
              type="search"
              placeholder="Search for books online"
              aria-label="Search online"
            />
            <div className={styles.emptyCard}>
              <h2>Online search is coming soon</h2>
              <p>For now, add PDFs with “Add books”, or drag them into this window.</p>
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <div className={styles.settingsPane}>
            <SettingsView embedded />
          </div>
        )}
      </main>
    </div>
  )
}
