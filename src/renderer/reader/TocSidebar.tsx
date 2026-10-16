import type { OutlineItem } from './pdf/pdfService'
import styles from './Reader.module.css'

type Props = { outline: OutlineItem[]; onGoTo(page: number): void; variant?: 'popover' }

function Items({
  items,
  onGoTo
}: {
  items: OutlineItem[]
  onGoTo(page: number): void
}): React.JSX.Element {
  return (
    <ul className={styles.tocList}>
      {items.map((it, i) => (
        <li key={i}>
          <button
            className={styles.tocItem}
            disabled={it.page === null}
            onClick={() => it.page !== null && onGoTo(it.page)}
          >
            <span>{it.title}</span>
            {it.page !== null && <span className={styles.tocPage}>{it.page}</span>}
          </button>
          {it.children.length > 0 && <Items items={it.children} onGoTo={onGoTo} />}
        </li>
      ))}
    </ul>
  )
}

export function TocSidebar({ outline, onGoTo, variant }: Props): React.JSX.Element {
  return (
    <aside
      className={variant === 'popover' ? styles.tocPopover : styles.toc}
      aria-label="Table of contents"
    >
      <h2 className={styles.tocHeading}>Contents</h2>
      {outline.length === 0 ? (
        <p className={styles.tocEmpty}>This PDF has no table of contents.</p>
      ) : (
        <Items items={outline} onGoTo={onGoTo} />
      )}
    </aside>
  )
}
