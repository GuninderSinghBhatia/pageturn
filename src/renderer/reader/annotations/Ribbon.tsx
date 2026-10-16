import { useAnnotationStore } from '../../stores/annotationStore'
import styles from './Annotations.module.css'

type Props = { page: number; bookmarked: boolean; side: 'left' | 'right' }

/** Bookmark ribbon at the page's top outer corner: faint until hovered, solid when set. */
export function Ribbon({ page, bookmarked, side }: Props): React.JSX.Element {
  return (
    <button
      className={`${styles.ribbon} ${side === 'left' ? styles.ribbonLeft : styles.ribbonRight}`}
      data-no-turn
      aria-label={`Bookmark page ${page}`}
      aria-pressed={bookmarked}
      title={bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
      onClick={() => useAnnotationStore.getState().toggleBookmark(page)}
    />
  )
}
