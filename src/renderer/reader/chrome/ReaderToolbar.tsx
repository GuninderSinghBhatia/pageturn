import { useEffect, useLayoutEffect, useRef } from 'react'
import { HIGHLIGHT_COLORS } from '@shared/types'
import { WindowControls } from '../../app/WindowControls'
import { useNotebookStore } from '../../notebook/notebookStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { HIGHLIGHT_HEX } from '../annotations/draw'
import { FindBar } from '../FindBar'
import { PenOptions } from '../ink/InkToolbar'
import { useInkStore } from '../ink/inkStore'
import type { ResolvedLayout } from '../layout'
import type { OpenedDoc } from '../pdf/pdfService'
import { TocSidebar } from '../TocSidebar'
import { toolbarReveal, useChromeStore, type Panel } from './chromeStore'
import { DisplayMenu } from './DisplayMenu'
import { Icons } from './icons'
import { PageIndicator } from './PageIndicator'
import styles from './Toolbar.module.css'

type Props = {
  doc: OpenedDoc
  visiblePage: number
  zoom: number
  layout: ResolvedLayout
  onBack(): void
  onGoTo(page: number): void
  onBookmark(): void
  onZoom(z: number): void
  onLayout(l: ResolvedLayout): void
  onFullscreen(): void
}

/** The hidden top toolbar: slides in at the top edge, holds while a tool is active. */
export function ReaderToolbar(p: Props): React.JSX.Element {
  const zoneRef = useRef<HTMLDivElement>(null)
  const { visible, panel, textTool, setPanel, setTextTool } = useChromeStore()
  const ink = useInkStore((s) => s.mode)
  const highlightColor = useSettingsStore((s) => s.settings.highlightColor)
  const toolActive = !!textTool || ink.active

  // Reveal on pointer position; hold while a tool is active or the pill has focus.
  useEffect(() => {
    const reveal = toolbarReveal()
    const move = (e: PointerEvent): void =>
      reveal.pointer(e.clientY, !!zoneRef.current?.contains(e.target as Node))
    const zone = zoneRef.current!
    const focusIn = (): void => reveal.setFocused(true)
    const focusOut = (e: FocusEvent): void =>
      reveal.setFocused(zone.contains(e.relatedTarget as Node))
    window.addEventListener('pointermove', move)
    zone.addEventListener('focusin', focusIn)
    zone.addEventListener('focusout', focusOut)
    return () => {
      window.removeEventListener('pointermove', move)
      zone.removeEventListener('focusin', focusIn)
      zone.removeEventListener('focusout', focusOut)
    }
  }, [])
  useEffect(() => toolbarReveal().setPinned(toolActive), [toolActive])

  // Hidden controls must not be reachable by keyboard either. A layout effect, so it runs before
  // children's effects that focus an input (Ctrl+F / Ctrl+G open and focus in one go).
  useLayoutEffect(() => {
    if (visible) zoneRef.current?.removeAttribute('inert')
    else zoneRef.current?.setAttribute('inert', '')
  }, [visible])

  const toggle = (next: Panel): void => setPanel(panel === next ? null : next)
  const notebookOpen = useNotebookStore((s) => s.open)
  const toggleNotebook = useNotebookStore((s) => s.toggle)
  const btn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    pressed?: boolean
  ): React.JSX.Element => (
    <button
      className={styles.icon}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  const isHighlight = textTool?.kind === 'highlight'
  const isUnderline = textTool?.kind === 'underline'
  const isPen = ink.active && ink.tool !== 'eraser'
  const isEraser = ink.active && ink.tool === 'eraser'
  const ui = useInkStore.getState

  return (
    <div
      ref={zoneRef}
      className={`${styles.zone} ${visible ? styles.shown : ''}`}
      data-no-turn
      data-visible={visible}
    >
      <div className={styles.mainRow}>
        <div className={styles.pill} role="toolbar" aria-label="Reader tools">
          {btn('Back to library', Icons.back, p.onBack)}
          <span className={styles.sep} />
          {btn(
            'Highlighter',
            Icons.highlighter,
            () => setTextTool(isHighlight ? null : { kind: 'highlight' }),
            isHighlight
          )}
          {btn(
            'Underline',
            Icons.underline,
            () => setTextTool(isUnderline ? null : { kind: 'underline', style: 'underline' }),
            isUnderline
          )}
          {btn(
            'Pen',
            Icons.pen,
            () => {
              setTextTool(null)
              ui().setMode(isPen ? { active: false } : { active: true, tool: 'pen' })
            },
            isPen
          )}
          {btn(
            'Eraser',
            Icons.eraser,
            () => {
              setTextTool(null)
              ui().setMode(isEraser ? { active: false } : { active: true, tool: 'eraser' })
            },
            isEraser
          )}
          <span className={styles.sep} />
          {btn('Bookmark page', Icons.bookmark, p.onBookmark)}
          {btn('Contents', Icons.contents, () => toggle('contents'), panel === 'contents')}
          {btn('Notebook', Icons.notebook, toggleNotebook, notebookOpen)}
          {btn('Search', Icons.search, () => toggle('search'), panel === 'search')}
          {panel === 'search' && (
            <FindBar
              inline
              doc={p.doc}
              visibleLast={p.visiblePage}
              onJump={p.onGoTo}
              onClose={() => setPanel(null)}
            />
          )}
          <PageIndicator visiblePage={p.visiblePage} numPages={p.doc.numPages} onGoTo={p.onGoTo} />
          {btn('Display', Icons.display, () => toggle('display'), panel === 'display')}
          {btn('Fullscreen', Icons.fullscreen, p.onFullscreen)}
        </div>
        {/* Window buttons ride along with the tools, so they never cover the page. */}
        <WindowControls inline />
      </div>

      {isHighlight && (
        <div className={styles.subrow} role="group" aria-label="Highlighter colour">
          {HIGHLIGHT_COLORS.filter((c) => c !== 'purple').map((c) => (
            <button
              key={c}
              className={styles.swatch}
              style={{ background: HIGHLIGHT_HEX[c] }}
              aria-label={c}
              aria-pressed={highlightColor === c}
              onClick={() => void useSettingsStore.getState().set({ highlightColor: c })}
            />
          ))}
        </div>
      )}
      {textTool?.kind === 'underline' && (
        <div className={styles.subrow} role="group" aria-label="Underline style">
          {(['underline', 'wavy'] as const).map((st) => (
            <button
              key={st}
              className={styles.chip}
              aria-pressed={textTool.style === st}
              onClick={() => setTextTool({ kind: 'underline', style: st })}
            >
              {st === 'underline' ? 'Straight' : 'Wavy'}
            </button>
          ))}
        </div>
      )}
      {isPen && <PenOptions />}
      {panel === 'contents' && (
        <div className={styles.popover}>
          <TocSidebar
            variant="popover"
            outline={p.doc.outline}
            onGoTo={(pg) => {
              p.onGoTo(pg)
              setPanel(null)
            }}
          />
        </div>
      )}
      {panel === 'display' && (
        <DisplayMenu zoom={p.zoom} layout={p.layout} onZoom={p.onZoom} onLayout={p.onLayout} />
      )}
    </div>
  )
}
