import { useEffect } from 'react'
import { HomeView } from '../home/HomeView'
import { ReaderView } from '../reader/ReaderView'
import { SettingsView } from '../settings/SettingsView'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNav } from './nav'
import { useThemeSync } from './theme'
import { Toasts } from './Toasts'
import { WindowControls } from './WindowControls'
import './theme.css'
import './base.css'

function App(): React.JSX.Element {
  const { view, goReader, settingsOpen, closeSettings } = useNav()
  useThemeSync(useSettingsStore((s) => s.settings.theme))

  useEffect(() => {
    void useSettingsStore.getState().load()
    // Files opened from Explorer / command line while running.
    return window.api.library.onOpenRequest((book) => {
      void useLibraryStore.getState().refresh()
      goReader(book.id)
    })
  }, [goReader])

  return (
    <>
      {view === 'library' ? (
        <HomeView />
      ) : (
        <ReaderView key={view.reader} bookId={view.reader} startPage={view.page} />
      )}
      {settingsOpen && <SettingsView onBack={closeSettings} />}
      <Toasts />
      <WindowControls />
    </>
  )
}

export default App
