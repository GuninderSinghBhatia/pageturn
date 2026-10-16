import { INK_COLORS, INK_WIDTHS } from '@shared/types'
import { Icons } from '../chrome/icons'
import styles from '../chrome/Toolbar.module.css'
import { WIDTH_LABELS } from './inkInput'
import { useInkStore } from './inkStore'

/** Options row under the toolbar while the pen is active: kind, colour, width, undo/redo. */
export function PenOptions(): React.JSX.Element {
  const mode = useInkStore((s) => s.mode)
  const setMode = useInkStore((s) => s.setMode)
  return (
    <div className={styles.subrow} role="group" aria-label="Pen options">
      <button
        className={styles.chip}
        aria-pressed={mode.tool === 'pen'}
        onClick={() => setMode({ tool: 'pen' })}
      >
        Pen
      </button>
      <button
        className={styles.chip}
        aria-pressed={mode.tool === 'highlighter'}
        onClick={() => setMode({ tool: 'highlighter' })}
      >
        Marker
      </button>
      <span className={styles.sep} />
      {INK_COLORS.map((c) => (
        <button
          key={c}
          className={styles.swatch}
          style={{ background: c }}
          aria-label={`Ink colour ${c}`}
          aria-pressed={mode.color === c}
          onClick={() => setMode({ color: c })}
        />
      ))}
      <span className={styles.sep} />
      {INK_WIDTHS.map((w, i) => (
        <button
          key={w}
          className={styles.icon}
          aria-label={WIDTH_LABELS[i]}
          aria-pressed={mode.width === w}
          onClick={() => setMode({ width: w })}
        >
          <span className={styles.dot} style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
        </button>
      ))}
      <span className={styles.sep} />
      <button
        className={styles.icon}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={() => useInkStore.getState().undo()}
      >
        {Icons.undo}
      </button>
      <button
        className={styles.icon}
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        onClick={() => useInkStore.getState().redo()}
      >
        {Icons.redo}
      </button>
    </div>
  )
}
