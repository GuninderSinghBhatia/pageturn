import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useNav } from './nav'
import styles from './Onboarding.module.css'

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Welcome to PageTurn',
    body: 'Your books live here in the library. Add PDFs with “Add books” or drop them on the window.'
  },
  {
    title: 'Open a book',
    body: 'Click a cover to bring it to the middle, then click again to open it. Try the Welcome book.'
  },
  {
    title: 'Turn pages like paper',
    body: 'Use the arrow keys, click near a page edge, or drag a corner across.'
  },
  {
    title: 'Stuck on a passage?',
    body: 'Select it and press Ctrl+E to get an explanation or search the web, without leaving the book.'
  }
]

/** First-run tour (4 short cards). Finishing or skipping it is remembered. */
export function Onboarding(): React.JSX.Element | null {
  const { loaded, settings, set } = useSettingsStore()
  const onLibrary = useNav((s) => s.view === 'library' && !s.settingsOpen)
  const [step, setStep] = useState(0)
  const nextRef = useRef<HTMLButtonElement>(null)
  const show = loaded && !settings.onboardingDone && onLibrary

  useEffect(() => {
    if (show) nextRef.current?.focus()
  }, [show, step])

  if (!show) return null
  const finish = (): void => {
    setStep(0)
    void set({ onboardingDone: true })
  }
  const last = step === STEPS.length - 1
  const { title, body } = STEPS[step]

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome tour"
        onKeyDown={(e) => e.key === 'Escape' && finish()}
      >
        <p className={styles.count}>
          {step + 1} of {STEPS.length}
        </p>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? styles.on : undefined} />
          ))}
        </div>
        <div className={styles.actions}>
          {!last && (
            <button className={styles.ghost} onClick={finish}>
              Skip
            </button>
          )}
          <button
            ref={nextRef}
            className={styles.primary}
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
