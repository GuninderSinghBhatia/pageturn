import { INK_COLORS, INK_WIDTHS } from '@shared/types'
import { useInkStore } from './inkStore'
import { WIDTH_LABELS, type InkMode } from './inkInput'
import styles from './Ink.module.css'

const TOOLS: { tool: InkMode['tool']; label: string; glyph: string }[] = [
  { tool: 'pen', label: 'Pen', glyph: '✎' },
  { tool: 'highlighter', label: 'Highlighter', glyph: '▌' },
  { tool: 'eraser', label: 'Eraser', glyph: '⌫' }
]

type Props = { children?: React.ReactNode } // extra controls (undo/redo)

/** Floating pen toolbar shown while pen mode is on. */
export function InkToolbar({ children }: Props): React.JSX.Element {
  const mode = useInkStore((s) => s.mode)
  const setMode = useInkStore((s) => s.setMode)
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Pen" data-no-turn>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={styles.btn}
          aria-label={t.label}
          aria-pressed={mode.tool === t.tool}
          title={t.label}
          onClick={() => setMode({ tool: t.tool })}
        >
          {t.glyph}
        </button>
      ))}
      <span className={styles.sep} />
      {INK_COLORS.map((c) => (
        <button
          key={c}
          className={styles.swatch}
          style={{ background: c }}
          aria-label={`Ink colour ${c}`}
          aria-pressed={mode.color === c}
          onClick={() => setMode({ color: c, tool: mode.tool === 'eraser' ? 'pen' : mode.tool })}
        />
      ))}
      <span className={styles.sep} />
      {INK_WIDTHS.map((w, i) => (
        <button
          key={w}
          className={styles.btn}
          aria-label={WIDTH_LABELS[i]}
          aria-pressed={mode.width === w}
          title={WIDTH_LABELS[i]}
          onClick={() => setMode({ width: w })}
        >
          <span className={styles.dot} style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
        </button>
      ))}
      {children && <span className={styles.sep} />}
      {children}
      <span className={styles.sep} />
      <button className={styles.done} onClick={() => setMode({ active: false })}>
        Done
      </button>
    </div>
  )
}
