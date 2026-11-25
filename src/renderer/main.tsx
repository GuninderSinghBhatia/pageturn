import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './app/App'

// Inside Tauri there is no Electron preload: install the Tauri-backed window.api first.
async function start(): Promise<void> {
  if ('__TAURI_INTERNALS__' in window) await (await import('./platform/tauriApi')).install()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
void start()
