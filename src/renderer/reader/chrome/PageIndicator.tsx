import { useEffect, useRef, useState } from 'react'
import { useChromeStore } from './chromeStore'
import styles from './Toolbar.module.css'

type Props = { visiblePage: number; numPages: number; onGoTo(page: number): void }

/** "12 / 500"; click the number to type a page. The only place progress is shown. */
export function PageIndicator({ visiblePage, numPages, onGoTo }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(String(visiblePage))
  const [prevPage, setPrevPage] = useState(visiblePage)
  const ref = useRef<HTMLInputElement>(null)
  const focusTick = useChromeStore((s) => s.focusPageBox)
  if (prevPage !== visiblePage) {
    setPrevPage(visiblePage)
    setDraft(String(visiblePage))
  }

  useEffect(() => {
    if (focusTick) ref.current?.select()
  }, [focusTick])

  const commit = (): void => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) onGoTo(n)
    else setDraft(String(visiblePage))
  }

  return (
    <span className={styles.pages}>
      <input
        ref={ref}
        className={styles.pageBox}
        data-testid="page-box"
        aria-label="Page"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
        }}
        onBlur={commit}
      />
      <span className={styles.pageTotal}>/ {numPages}</span>
    </span>
  )
}
