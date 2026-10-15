import { useEffect } from 'react'
import { LibraryView } from '../library/LibraryView'
import { ReaderView } from '../reader/ReaderView'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNav } from './nav'
import './base.css'

function App(): React.JSX.Element {
  const { view, goReader } = useNav()

  useEffect(() => {
    void useSettingsStore.getState().load()
    // Files opened from Explorer / command line while running.
    return window.api.library.onOpenRequest((book) => {
      void useLibraryStore.getState().refresh()
      goReader(book.id)
    })
  }, [goReader])

  if (view === 'library') return <LibraryView />
  return <ReaderView key={view.reader} bookId={view.reader} />
}

export default App
