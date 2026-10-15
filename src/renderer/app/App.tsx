import { useEffect } from 'react'
import { LibraryView } from '../library/LibraryView'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNav } from './nav'
import './base.css'

function App(): React.JSX.Element {
  const { view, goReader, goLibrary } = useNav()

  useEffect(() => {
    void useSettingsStore.getState().load()
    // Files opened from Explorer / command line while running.
    return window.api.library.onOpenRequest((book) => {
      void useLibraryStore.getState().refresh()
      goReader(book.id)
    })
  }, [goReader])

  if (view === 'library') return <LibraryView />
  // The reader arrives in Task 7.
  return (
    <div style={{ padding: 24 }}>
      <button onClick={goLibrary}>← Library</button>
      <p>Reader for {view.reader}</p>
    </div>
  )
}

export default App
