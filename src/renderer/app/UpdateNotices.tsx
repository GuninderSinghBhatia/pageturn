import { useEffect } from 'react'
import { useToastStore } from '../stores/toastStore'

/**
 * Tells the reader about a new version: when one is found (it downloads in the background)
 * and when it is ready, with a button to restart into it. Each version is announced once.
 */
export function UpdateNotices(): null {
  useEffect(() => {
    const toasts = useToastStore.getState()
    const seen = new Set<string>()
    let downloading: string | null = null
    const offAvailable = window.api.app?.onUpdateAvailable?.(({ version }) => {
      if (seen.has(`a${version}`)) return
      seen.add(`a${version}`)
      downloading = toasts.show(
        `PageTurn ${version} is available. Downloading it in the background…`,
        {
          sticky: true
        }
      )
    })
    const offDownloaded = window.api.app?.onUpdateDownloaded?.(({ version }) => {
      if (seen.has(`d${version}`)) return
      seen.add(`d${version}`)
      if (downloading) toasts.dismiss(downloading)
      toasts.show(`PageTurn ${version} is ready to install.`, {
        sticky: true,
        action: { label: 'Restart now', run: () => void window.api.app.installUpdate() }
      })
    })
    return () => {
      offAvailable?.()
      offDownloaded?.()
    }
  }, [])
  return null
}
