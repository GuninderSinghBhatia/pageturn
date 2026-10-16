import { useToastStore } from '../stores/toastStore'

/** Transient messages (e.g. a save that failed) in the bottom-right corner. */
export function Toasts(): React.JSX.Element | null {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast">
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
