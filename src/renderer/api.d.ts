import type { Api } from '../shared/ipc'

// window.api is installed by platform/tauriApi.ts before React starts.
declare global {
  interface Window {
    api: Api
  }
}

export {}
