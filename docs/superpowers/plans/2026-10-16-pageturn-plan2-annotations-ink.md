# PageTurn Plan 2 — Annotations + Ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers can select text, highlight it in five colours, attach notes (to highlights or free-floating), bookmark pages and draw pressure-sensitive ink. Everything persists across restarts and file moves, and turns with the paper inside the WebGL curl.

**Architecture:** Main owns four new SQLite tables behind an `annotations` IPC domain. The renderer keeps the open book's annotations in a Zustand `annotationStore`: updates are optimistic, with retry, rollback and a toast on failure, and a per-page `revision` counter. Both stages render a shared `PageOverlay` per visible page, containing the pdf.js text layer, an annotation canvas, note icons and the bookmark ribbon. The same `drawPageAnnotations()` draws that canvas and bakes annotations into the curl textures, so settled and turning pages look identical.

**Tech Stack:** as Plan 1, plus `perfect-freehand` (^1.2) for ink outlines and pdf.js `TextLayer` for selection.

**Spec:** `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md`: §4.4 (all), §4.1 "Remove… asks whether to also delete annotations", §4.3 text layer, §4.7 Pen settings, §4.8 shortcuts `H P E Ctrl+D Esc`, §5 "page textures = bitmap + annotation/ink overlay", §6 tables, §7 `annotations.*`, §8 "DB write fails", §10 milestones 5–6.

**Out of scope (later plans):** Explain/Help buttons in toolbars and popovers (Plan 3). Notebook panel, Markdown export, backups and the `notes_fts` search UI (Plan 4); the FTS table is created here so Plan 4 needs no migration.

## Global Constraints

- Annotation coordinates are normalized 0..1 of page width (x) and page height (y). Ink `width` is a fraction of page width.
- Highlight colours exactly `'yellow'|'green'|'blue'|'pink'|'purple'`; drawn with multiply blend at alpha 0.4. Hex: yellow `#ffd84d`, green `#7ed87e`, blue `#7fb8ff`, pink `#ff9ccf`, purple `#c49cff`.
- Ink: 6 colours `#1f1f1f #d0342c #2a62c9 #2e8b57 #e07b00 #7b3fb5`; 3 widths `0.0025 | 0.005 | 0.01` (page widths). The highlighter draws at 4× width, alpha 0.35, multiply.
- Ink points are stored as a packed `Float32Array` blob `[x,y,p,…]`. IPC carries them as `[x,y,p][]`.
- IDs via `crypto.randomUUID()` (renderer generates them for optimistic inserts); timestamps in `Date.now()` ms.
- Every IPC payload is validated in main with zod via `parse()` (`src/main/ipc/validate.ts`).
- Note autosave: on blur and after a 500 ms typing pause.
- Shortcuts: `H` highlights the selection in the last-used colour · `P` toggles pen mode · `E` selects the eraser · `Ctrl+D` toggles a bookmark · `Ctrl+Z`/`Ctrl+Y` undo/redo ink · `Esc` closes popovers and leaves pen mode.
- DB write failure: retry 3× with backoff 200/400/800 ms, then roll back the optimistic change and toast "Couldn't save your change".
- Overlays are hidden while a curl turn is in progress (`data-settled="false"`); the baked textures show annotations instead.
- Files < ~300 lines; CSS Modules; tokens from `app/theme.css`.

## Review Focus

1. **Typing in a note** must not trigger reader shortcuts. Arrows, `H`, `P`, `E`, `Ctrl+D` and `Ctrl+Z` act on the textarea, and `Ctrl+Z` is native text undo, not ink undo. (Task 7 test.)
2. **A selection spanning both pages of a spread** creates one highlight per page, each with that page's own text, and no rects outside the page. (Task 6 e2e.)
3. **A DB write fails**: the optimistic highlight disappears after the retries, a toast shows, and nothing is left half-saved. (Task 3 test.)
4. **Remove a book but keep annotations, then re-import the same file**: the annotations come back. (Task 2 test.)
5. **After a layout switch (spread↔single) or zoom**, clicking highlighted text still opens that highlight's popover. Hit-testing uses normalized coordinates. (Task 6 e2e.)

---

## File Structure

```
src/shared/types.ts                     + HighlightColor, Rect, Highlight, Note, InkStroke, Bookmark, BookAnnotations, InkTool; Settings + highlightColor, drawWithMouse, penColor, penWidth
src/shared/ipc.ts                       + annotation channels/schemas; library.remove(bookId, deleteAnnotations)
src/main/db/migrations/002_annotations.sql   tables, indexes, notes_fts + sync triggers, books.removed_at
src/main/db/repositories/annotations.ts AnnotationsRepo (highlights, notes, bookmarks)
src/main/db/repositories/ink.ts         InkRepo (Float32 blob packing)
src/main/ipc/annotations.ts             handlers
src/renderer/stores/annotationStore.ts  per-book state, optimistic mutations, revision per page
src/renderer/stores/toastStore.ts       + src/renderer/app/Toasts.tsx
src/renderer/reader/annotations/rects.ts      normalize/merge/hit-test (pure)
src/renderer/reader/annotations/draw.ts       drawPageAnnotations (shared by overlay + bake)
src/renderer/reader/annotations/PageOverlay.tsx   text layer + canvas + icons + ribbon for one page
src/renderer/reader/annotations/selection.ts  DOM selection → per-page {text, rects}
src/renderer/reader/annotations/SelectionToolbar.tsx, HighlightPopover.tsx, NotePopover.tsx, Annotations.module.css
src/renderer/reader/pdf/TextLayer.tsx   pdf.js TextLayer wrapper
src/renderer/reader/ink/strokes.ts      perfect-freehand path, eraser hit-test (pure)
src/renderer/reader/ink/history.ts      per-page undo/redo (pure)
src/renderer/reader/ink/inkInput.ts     pointer → draw/erase/pass decision (pure) + useInkInput hook
src/renderer/reader/ink/InkToolbar.tsx  tools, colours, widths
src/renderer/reader/BookStage/bake.ts   BakeCache: (page, revision, bitmap) → baked ImageBitmap
```

---

### Task 1: Annotation types, schemas, migration, repositories

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts` (schemas only), `src/main/db/repositories/books.ts`
- Create: `src/main/db/migrations/002_annotations.sql`, `src/main/db/repositories/annotations.ts`, `src/main/db/repositories/ink.ts`
- Test: `tests/unit/main/annotations.test.ts`, extend `tests/unit/shared/ipc.test.ts`, extend `tests/unit/main/db.test.ts` (user_version now 2)

**Interfaces:**
- Produces (`shared/types.ts`):
```ts
type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'
type Rect = { x: number; y: number; w: number; h: number }
type Highlight = { id: string; bookId: string; page: number; rects: Rect[]; text: string; color: HighlightColor; noteId: string | null; createdAt: number; updatedAt: number }
type Note = { id: string; bookId: string; page: number; anchor: { highlightId?: string; point?: { x: number; y: number } }; body: string; createdAt: number; updatedAt: number }
type InkTool = 'pen' | 'highlighter'
type InkStroke = { id: string; bookId: string; page: number; points: [number, number, number][]; color: string; width: number; tool: InkTool; createdAt: number }
type Bookmark = { id: string; bookId: string; page: number; label: string | null; createdAt: number }
type BookAnnotations = { highlights: Highlight[]; notes: Note[]; ink: InkStroke[]; bookmarks: Bookmark[] }
// Settings additions (+ DEFAULT_SETTINGS): highlightColor: HighlightColor = 'yellow'; drawWithMouse = false; penColor = '#1f1f1f'; penWidth = 0.005
```
- Produces (`shared/ipc.ts`): `HighlightSchema`, `NoteSchema`, `InkStrokeSchema` (points: max 20 000, each value finite, x/y in [-0.05, 1.05], p in [0,1]), `InkIdsSchema` (uuid[] max 500), `IdSchema` (uuid), `BookmarkLabelSchema` (string ≤ 200, optional). `SettingsPartialSchema` gains the four new keys (`penColor` must be one of the 6 ink hex values; `penWidth` one of the 3 widths).
- Produces repos (each method synchronous, takes/returns the shared types):
```ts
class AnnotationsRepo { constructor(db)
  listForBook(bookId): Omit<BookAnnotations, 'ink'>
  upsertHighlight(h: Highlight): void
  deleteHighlight(id): void            // also deletes its note (transaction)
  upsertNote(n: Note): void            // if n.anchor.highlightId: sets that highlight's note_id
  deleteNote(id): void                 // clears note_id on any highlight pointing at it
  toggleBookmark(bookId, page, label?: string | null, id?: string): Bookmark | null   // null = removed
  deleteAllForBook(bookId): void }     // highlights, notes, bookmarks, ink
class InkRepo { constructor(db)
  listForBook(bookId): InkStroke[]; add(strokes: InkStroke[]): void; delete(ids: string[]): void }
```
- `BooksRepo` changes: `remove(id)` becomes `hide(id)` (sets `removed_at = now`); `list()` excludes rows with `removed_at`; `upsert` clears `removed_at`; new `purge(id)` deletes the row (cascades).

- [ ] **Step 1: Failing tests** (`annotations.test.ts`, in-memory `openDb(':memory:')`, book row inserted first):
  - Highlight round-trip keeps `rects` exactly; `upsertHighlight` with the same id updates colour and `updatedAt`.
  - `upsertNote` with `anchor.highlightId` sets that highlight's `noteId`. `deleteHighlight` removes the highlight and its note. `deleteNote` sets the highlight's `noteId` back to null.
  - `notes_fts` stays in sync: after upsert, `SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'photosynthesis'` finds the note; after update/delete it doesn't.
  - `toggleBookmark(b, 5)` returns a Bookmark, a second call returns null, and `listForBook` reflects each state.
  - Ink: `add` two strokes, then `listForBook` returns points equal within 1e-6 (Float32 precision); `delete([id])` removes one.
  - `hide` then `list()` excludes the book, but its highlights remain. `upsert` of the same id restores it with highlights intact (Review Focus 4). `purge` cascades everything away.
  - ipc.test: `InkStrokeSchema` rejects NaN and points outside [-0.05, 1.05]; `HighlightSchema` rejects colour `'red'`; `SettingsPartialSchema` rejects `penWidth: 0.003`.
- [ ] **Step 2:** `npx vitest run tests/unit/main tests/unit/shared` → FAIL.
- [ ] **Step 3: Implement.** Migration `002_annotations.sql`: the four tables and indexes exactly as spec §6, plus `ALTER TABLE books ADD COLUMN removed_at INTEGER`. Add `notes_fts` (external content) with `AFTER INSERT/UPDATE/DELETE` triggers on `notes` using the standard fts5 `'delete'` command pattern. Blob packing: `Buffer.from(new Float32Array(points.flat()).buffer)` and back.
- [ ] **Step 4:** Run → PASS. `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat: annotation schema and repositories`.

### Task 2: Annotations IPC, preload, and Remove-with-annotations choice

**Files:**
- Create: `src/main/ipc/annotations.ts`
- Modify: `src/shared/ipc.ts` (channels + `Api.annotations`, `library.remove` signature), `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/library.ts`, `src/renderer/library/LibraryView.tsx` (remove confirm dialog), `src/renderer/library/LibraryView.module.css`
- Test: `tests/unit/main/annotationsIpc.test.ts`, `tests/e2e/library.spec.ts` (new case)

**Interfaces:**
- Consumes: Task 1 repos and schemas.
- Produces:
```ts
Api.annotations: {
  listForBook(bookId): Promise<BookAnnotations>
  upsertHighlight(h: Highlight): Promise<void>; deleteHighlight(id): Promise<void>
  upsertNote(n: Note): Promise<void>;           deleteNote(id): Promise<void>
  addInk(strokes: InkStroke[]): Promise<void>;  deleteInk(ids: string[]): Promise<void>
  toggleBookmark(bookId, page, label?: string | null, id?: string): Promise<Bookmark | null>
}
Api.library.remove(bookId: string, deleteAnnotations: boolean): Promise<void>
```
  Channels `annotations:list|upsertHighlight|deleteHighlight|upsertNote|deleteNote|addInk|deleteInk|toggleBookmark`. Handlers are registered by `registerAnnotationsIpc(annotations, ink, books)` and reject writes whose `bookId` is not a known book row.
- Remove: `deleteAnnotations ? purge : hide`. Hidden books are invisible everywhere except re-import.

- [ ] **Step 1: Failing unit test:** with `ipcMain.handle` mocked to capture handlers (`vi.mock('electron')`), `annotations:upsertHighlight` with an extra unknown key, or a bookId not in `books`, throws `'Invalid payload'`. A valid call persists and `annotations:list` returns it.
- [ ] **Step 2: Failing e2e** (`library.spec.ts`): import `text-500.pdf`, then `window.api.annotations.toggleBookmark(id, 4)`. Right-click card → Remove → dialog with checkbox "Also delete highlights, notes and drawings" (unchecked) → Remove. Card is gone. Re-import the same path: the card returns and `listForBook` still has the bookmark. Repeat with the box checked: the bookmark is gone after re-import.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement (dialog is an in-app modal styled like `PasswordPrompt`, not `window.confirm`). **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat: annotations IPC and remove-with-annotations choice`.

### Task 3: annotationStore and toasts

**Files:**
- Create: `src/renderer/stores/annotationStore.ts`, `src/renderer/stores/toastStore.ts`, `src/renderer/app/Toasts.tsx` (+ styles in `app/base.css`)
- Modify: `src/renderer/app/App.tsx` (render `<Toasts/>`), `src/renderer/reader/ReaderView.tsx` (load on open, clear on close)
- Test: `tests/unit/renderer/annotationStore.test.ts`

**Interfaces:**
- Consumes: `window.api.annotations` (Task 2).
- Produces:
```ts
type PageAnnotations = { highlights: Highlight[]; freeNotes: Note[]; ink: InkStroke[]; bookmark: Bookmark | null }
useAnnotationStore: {
  bookId: string | null; highlights: Record<string, Highlight>; notes: Record<string, Note>; ink: Record<string, InkStroke>; bookmarks: Record<number, Bookmark>
  revision: Record<number, number>   // bumped for a page on every change touching it
  load(bookId): Promise<void>; clear(): void
  addHighlights(hs: Omit<Highlight, 'id'|'bookId'|'createdAt'|'updatedAt'|'noteId'>[]): Highlight[]
  setHighlightColor(id, color): void; deleteHighlight(id): void
  saveNote(n: { id?: string; page: number; anchor: Note['anchor']; body: string }): Note   // creates or updates
  deleteNote(id): void
  addInk(strokes: Omit<InkStroke, 'id'|'bookId'|'createdAt'>[]): InkStroke[]; removeInk(ids: string[]): void; restoreInk(strokes: InkStroke[]): void
  toggleBookmark(page): void
}
function selectPage(s, page): PageAnnotations   // memoized per (page, revision[page])
useToastStore: { toasts: { id: string; text: string }[]; show(text: string): void; dismiss(id): void }   // auto-dismiss 4 s
```
  All mutations apply locally first, then call IPC through `persist(op, rollback)`. That retries 3× at 200/400/800 ms; on final failure it runs `rollback` (which bumps revision) and `toast.show("Couldn't save your change")`.

- [ ] **Step 1: Failing tests** (fake timers, mocked `window.api.annotations`):
  - `addHighlights` appears immediately in `selectPage(s, 3).highlights` and bumps `revision[3]`.
  - IPC rejects 4 times → after `vi.advanceTimersByTime(1400)` the highlight is gone, `revision[3]` bumped again, and one toast "Couldn't save your change" (Review Focus 3).
  - Rejects twice then resolves → highlight kept, no toast, 3 calls.
  - `deleteHighlight` on a highlight with a note removes the note locally too.
  - `saveNote` with `anchor.highlightId` sets that highlight's `noteId`.
  - `toggleBookmark(4)` twice → `bookmarks[4]` undefined, IPC called twice.
  - `selectPage` returns the same object when the page's revision hasn't changed.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: annotation store with optimistic saves and toasts`.

### Task 4: Pure geometry and drawing (rects, ink strokes, shared painter)

**Files:**
- Create: `src/renderer/reader/annotations/rects.ts`, `src/renderer/reader/ink/strokes.ts`, `src/renderer/reader/annotations/draw.ts`
- Modify: `package.json` (`perfect-freehand`)
- Test: `tests/unit/renderer/rects.test.ts`, `tests/unit/renderer/strokes.test.ts`, `tests/unit/renderer/draw.test.ts`

**Interfaces:**
- Produces:
```ts
// rects.ts
function normalizeRects(client: DOMRectLike[], page: DOMRectLike): Rect[]   // clip to page, drop < 1px, divide by page size
function mergeLineRects(rects: Rect[]): Rect[]   // same line = vertical overlap ≥ 50% of the smaller height; merge horizontally adjacent/overlapping (gap ≤ 0.01) into one rect
function hitHighlight(highlights: Highlight[], p: { x: number; y: number }): Highlight | null   // topmost (latest createdAt) containing p
// strokes.ts
function strokeOutline(points: [number, number, number][], width: number, sizePx: { w: number; h: number }, simulatePressure: boolean): [number, number][]   // perfect-freehand getStroke in px; thinning 0.6, smoothing 0.5, streamline 0.5
function strokeHit(stroke: InkStroke, p: { x: number; y: number }, radius: number, aspect: number): boolean   // distance to polyline (in page-width units) ≤ radius + width/2
// draw.ts
function drawPageAnnotations(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ann: PageAnnotations, w: number, h: number, live?: InkStroke): void
```
  `drawPageAnnotations` draws highlights first (multiply, alpha 0.4, colours from Global Constraints), then ink in `createdAt` order (pen `source-over`; highlighter multiply at 0.35), then `live`. It restores the composite op and alpha after each group. Note icons and the ribbon are not drawn here (DOM in overlay, drawn separately in bake).

- [ ] **Step 1: Failing tests:**
  - `normalizeRects` clips a rect half outside the page and drops a 0.5 px sliver.
  - `mergeLineRects` merges three word rects on one line into one, keeps two lines separate, and doesn't merge a rect in the other column (gap 0.2).
  - `hitHighlight` prefers the newer of two overlapping highlights; returns null outside.
  - `strokeOutline` on a 2-point stroke returns ≥ 4 points, all within the stroke bbox ± width.
  - `strokeHit` is true at the midpoint of a horizontal stroke, false 0.05 away with radius 0.01.
  - `draw.test`: a recording fake ctx shows `globalCompositeOperation = 'multiply'` set before the highlight `fillRect` calls (px = rect × w/h). Highlighter strokes fill with alpha 0.35. Composite op is `'source-over'` again at the end.
- [ ] **Step 2:** FAIL → **Step 3:** `npm i perfect-freehand@^1.2`, implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: annotation geometry and shared painter`.

### Task 5: Page overlay and text layer on both stages

**Files:**
- Create: `src/renderer/reader/pdf/TextLayer.tsx`, `src/renderer/reader/annotations/PageOverlay.tsx`, `src/renderer/reader/annotations/Annotations.module.css`
- Modify: `src/renderer/reader/pdf/pdfService.ts` (`renderTextLayer`), `src/renderer/reader/BookStage/SlideStage.tsx` + `PageCanvas.tsx` (overlay child), `src/renderer/reader/BookStage/BookStage.tsx` (positioned overlay boxes, hidden unless settled), `src/renderer/reader/BookStage/useTurnGesture.ts`, `src/renderer/reader/ReaderView.tsx`
- Test: `tests/e2e/annotations.spec.ts` (new)

**Interfaces:**
- Consumes: `selectPage`, `drawPageAnnotations`.
- Produces:
```ts
OpenedDoc.renderTextLayer(page: number, container: HTMLElement, cssWidth: number): { done: Promise<void>; cancel(): void }   // pdf.js TextLayer at scale cssWidth / pdfWidth
type OverlayRenderer = (page: number, size: { width: number; height: number }) => React.ReactNode
SlideStage/BookStage prop: renderOverlay?: OverlayRenderer
<PageOverlay page width height doc />   // root: data-page-overlay={page}, position absolute inset 0, pointer-events none
```
  PageOverlay layers, bottom to top:
  1. Annotation canvas at DPR × size, `mix-blend-mode: multiply`, redrawn when `revision[page]` or size changes.
  2. `TextLayer`: spans transparent, `pointer-events: auto`, `::selection` tinted with `--accent` at 30%.
  3. Interactive children (Tasks 6–7) marked `data-no-turn`.

  BookStage renders one absolutely positioned box per visible page at its rect, and sets `visibility: hidden` on them while `data-settled !== 'true'`.
- Gesture rules (`useTurnGesture`):
  - A pointerdown whose target is inside `[data-no-turn]` is ignored.
  - On a text-layer span it never starts a corner drag. It records the outer-third click, and on pointerup turns only if `getSelection()?.isCollapsed`.

- [ ] **Step 1: Failing e2e** (`annotations.spec.ts`):
  - (a) Open `text-500.pdf`, press → to spread 2–3. Drag the mouse across the first text line of page 2 (`[data-page-overlay="2"] span` bounding boxes). `window.getSelection().toString()` contains "Lorem", and the stage did not turn (`data-pages` still `2,3`).
  - (b) A plain click on text in page 3's outer third turns to `4,5`.
  - (c) Same as (a) with `pageTurnStyle: 'slide'` set via `window.api.settings.set` before opening.
  - (d) `scanned.pdf` opens with no `span` in its overlay and no console errors.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm run test:e2e` → all pass, including the existing `curl-mid.png` screenshot (overlays hidden mid-drag) and perf p95 ≤ 20 ms.
- [ ] **Step 5:** Commit `feat: page overlay with selectable text layer`.

### Task 6: Highlights — selection toolbar, popover, H shortcut

**Files:**
- Create: `src/renderer/reader/annotations/selection.ts`, `SelectionToolbar.tsx`, `HighlightPopover.tsx`
- Modify: `PageOverlay.tsx` (click → `hitHighlight` → popover), `ReaderView.tsx` (toolbar host), `useReaderKeys.ts` (`H`, `Esc`), `src/renderer/settings/SettingsView.tsx` (no UI change; `highlightColor` saved via store)
- Test: `tests/unit/renderer/SelectionToolbar.test.tsx`, `tests/e2e/annotations.spec.ts`

**Interfaces:**
- Consumes: `annotationStore.addHighlights/setHighlightColor/deleteHighlight/saveNote`, `normalizeRects`, `mergeLineRects`, `hitHighlight`.
- Produces:
```ts
function selectionByPage(sel: Selection, root: HTMLElement): { page: number; text: string; rects: Rect[] }[]   // one entry per [data-page-overlay] the range intersects; range clamped to that page's text layer; text trimmed; entries with no rects dropped
<SelectionToolbar anchor={DOMRect} onHighlight={(c: HighlightColor) => void} onCopy={() => void} />   // 5 swatches (aria-label = colour name) + Copy; last-used colour has aria-pressed
<HighlightPopover highlight onClose />   // colour swatches, "Add note"/"Edit note" (inline textarea, NotePopover from Task 7), Copy, Delete
```
  Toolbar shows on pointerup/keyup when the selection is non-collapsed and inside a text layer, positioned above the first rect. It hides on collapse, scroll, turn or Esc. Highlighting sets `settings.highlightColor` and clears the selection. `H` with a selection highlights in `settings.highlightColor`.

- [ ] **Step 1: Failing component test:** clicking the "green" swatch calls `onHighlight('green')`; the swatch matching `highlightColor` has `aria-pressed="true"`.
- [ ] **Step 2: Failing e2e:**
  - (a) Select text on page 2, click Yellow, add a note "check this" through the popover. Restart the app and reopen: page 2's overlay canvas is non-blank at the highlight centre (sampled via `getImageData`). Clicking it opens the popover with "check this". (Spec §9 e2e.)
  - (b) Drag a selection from page 2's last line into page 3's first line, then press `H`. `listForBook` has two highlights, pages 2 and 3, each with that page's own text, and all rects within 0..1 (Review Focus 2).
  - (c) After (a), toggle to single layout and back, and zoom to 150% and back to fit. Clicking the highlighted text still opens its popover (Review Focus 5).
  - (d) Popover Delete removes the highlight and its note.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: text highlights with colours, popover and H shortcut`.

### Task 7: Free notes and bookmarks

**Files:**
- Create: `src/renderer/reader/annotations/NotePopover.tsx`
- Modify: `PageOverlay.tsx` (context menu "Add note here", sticky icons, ribbon), `useReaderKeys.ts` (`Ctrl+D`; make shortcuts ignore events from textareas/inputs, including `Ctrl+Z/Y/D`), `Annotations.module.css`
- Test: `tests/unit/renderer/NotePopover.test.tsx`, `tests/unit/renderer/useReaderKeys.test.tsx` (new), `tests/e2e/annotations.spec.ts`

**Interfaces:**
- Consumes: `annotationStore.saveNote/deleteNote/toggleBookmark`.
- Produces:
```ts
<NotePopover note={Note | null} onSave={(body: string) => void} onDelete?={() => void} onClose />   // textarea autofocus; onSave on blur and 500 ms after the last keystroke when changed; empty body + close on a new note = nothing saved
```
  - Right-click on a page shows a context menu with "Add note here", placed at the pointer. It creates a free note `{ anchor: { point } }` and opens its popover.
  - Sticky icons render at `point` (`data-no-turn`); clicking one opens its popover.
  - Ribbon: a button at each page's top-outer corner, faint on hover and solid when bookmarked (`aria-pressed`, `aria-label="Bookmark page N"`). `Ctrl+D` toggles the bookmark of the lowest-numbered visible page.

- [ ] **Step 1: Failing tests:**
  - NotePopover (fake timers): typing "a", "b" then advancing 499 ms → no save; at 500 ms → `onSave('ab')` once. Blur after a change → save. Closing an untouched new note → no save.
  - useReaderKeys: dispatching `ArrowRight`, `h`, `p`, `Ctrl+D` and `Ctrl+Z` with `target` = a textarea calls no store action (Review Focus 1).
- [ ] **Step 2: Failing e2e:**
  - Right-click page 3 → Add note here → type "remember" → click elsewhere. Restart: the sticky icon is visible on page 3 and opens "remember".
  - `Ctrl+D` on spread 2–3 → ribbon on page 2 has `aria-pressed="true"`. Restart: still pressed. `Ctrl+D` again → unpressed.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: free notes and bookmarks`.

### Task 8: Bake annotations into curl textures

**Files:**
- Create: `src/renderer/reader/BookStage/bake.ts`
- Modify: `src/renderer/reader/BookStage/BookStage.tsx`
- Test: `tests/unit/renderer/bake.test.ts`, `tests/e2e/annotations.spec.ts`

**Interfaces:**
- Consumes: `drawPageAnnotations`, `selectPage`, `revision`.
- Produces:
```ts
class BakeCache { constructor(bake = bakePage)
  get(page: number, bmp: ImageBitmap, revision: number, ann: PageAnnotations): ImageBitmap   // returns bmp itself when the page has no annotations; caches by (page, bmp, revision); closes replaced baked bitmaps
  retain(pages: Set<number>): void; clear(): void }
function bakePage(bmp: ImageBitmap, ann: PageAnnotations): ImageBitmap   // OffscreenCanvas: drawImage, drawPageAnnotations, sticky-note glyphs, ribbon
```
  - BookStage uses raw bitmaps for the static spread while settled; the DOM overlay draws annotations then.
  - It uses baked bitmaps for `front/back/leftUnder/rightUnder` (and the static pages) while a turn is in progress.
  - While idle it preloads (uploads) the baked bitmaps of the current spread's turnable pages, so a turn starts without a hitch.
  - It exposes `data-baked` = comma list of pages whose baked texture differs from raw.

- [ ] **Step 1: Failing unit tests** (inject a fake `bake` that returns tagged objects):
  - No annotations → the same `bmp` instance and no bake call.
  - Same (page, bmp, revision) twice → bake called once.
  - New revision → bake called again and the old baked bitmap's `close` called.
  - `retain(new Set([2]))` closes page 3's entry.
- [ ] **Step 2: Failing e2e:** highlight text on page 3 (spread 2–3), then start a mouse drag from page 3's corner and hold it. `data-baked` contains `3`. Release → settles, overlay visible again.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS; perf e2e p95 still ≤ 20 ms.
- [ ] **Step 6:** Commit `feat: annotations turn with the page in the curl`.

### Task 9: Ink — pen mode, drawing, persistence, pen settings

**Files:**
- Create: `src/renderer/reader/ink/inkInput.ts`, `src/renderer/reader/ink/InkToolbar.tsx`
- Modify: `PageOverlay.tsx` (live stroke on the overlay canvas), `ReaderView.tsx` (pen mode state, toolbar, `useInkInput` on the viewport), `useReaderKeys.ts` (`P`, `Esc` exits pen mode), `NavBar.tsx` (pen toggle button), `src/renderer/settings/SettingsView.tsx` (Pen section: draw with mouse, default colour, default width), `tests/unit/renderer/SettingsView.test.tsx`
- Test: `tests/unit/renderer/inkInput.test.ts`, `tests/e2e/ink.spec.ts`

**Interfaces:**
- Consumes: `strokeOutline`, `drawPageAnnotations(…, live)`, `annotationStore.addInk`.
- Produces:
```ts
type InkMode = { active: boolean; tool: 'pen' | 'highlighter' | 'eraser'; color: string; width: number }
function inkAction(e: { pointerType: string; buttons: number; button: number }, mode: InkMode, drawWithMouse: boolean): 'draw' | 'erase' | 'pass'
//  inactive → pass; touch → pass; mouse without drawWithMouse → pass; pen eraser end (buttons & 32 or button === 5) → erase; tool eraser → erase; else draw
function useInkInput(opts: { viewportRef; mode: InkMode; drawWithMouse: boolean; pageAt(clientX, clientY): { page: number; box: DOMRect } | null; onLive(page: number, s: InkStroke | null): void; onCommit(page: number, s: InkStroke): void; onErase(page: number, p: { x: number; y: number }): void }): void
```
  - Capture-phase `pointerdown` on the viewport. `'pass'` lets the event reach the stage (turns, text selection). `draw`/`erase` calls `stopPropagation()` and `setPointerCapture`.
  - Points are recorded as normalized `[x, y, pressure]`; mouse pressure is 0.5 and `simulatePressure` is used when `pointerType !== 'pen'`.
  - The stroke commits on pointerup if it has ≥ 2 points.
  - Pen mode shows `InkToolbar` (tool buttons, 6 colour swatches, 3 width buttons, Undo/Redo, Done), a crosshair cursor, and disables the text layer (`pointer-events: none`) while active.

- [ ] **Step 1: Failing unit tests:** `inkAction` table covering every branch above. SettingsView: toggling "Draw with mouse" calls `set({ drawWithMouse: true })`.
- [ ] **Step 2: Failing e2e** (`ink.spec.ts`):
  - With `drawWithMouse` false, press `P` and mouse-drag across page 2 → no stroke (`listForBook().ink` empty); the stage behaves as normal.
  - Set `drawWithMouse` true, then drag → one stroke on page 2, all points within 0..1, and the overlay canvas non-blank along the path.
  - Restart → the stroke is drawn again.
  - `Esc` leaves pen mode (toolbar gone).
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: pen mode with pressure-sensitive ink`.

### Task 10: Eraser and ink undo/redo

**Files:**
- Create: `src/renderer/reader/ink/history.ts`
- Modify: `ReaderView.tsx` / `InkToolbar.tsx` (eraser tool, undo/redo buttons), `useReaderKeys.ts` (`E`, `Ctrl+Z`, `Ctrl+Y`)
- Test: `tests/unit/renderer/history.test.ts`, `tests/e2e/ink.spec.ts`

**Interfaces:**
- Consumes: `strokeHit`, `annotationStore.addInk/removeInk/restoreInk`, `inkAction` (`'erase'`).
- Produces:
```ts
type InkOp = { kind: 'add' | 'erase'; page: number; strokes: InkStroke[]; at: number }
class InkHistory { push(op: InkOp): void   // clears that page's redo stack
  undo(visible: number[]): InkOp | null    // newest undo entry among visible pages, moved to redo
  redo(visible: number[]): InkOp | null    // newest redo entry among visible pages
  clear(): void }
```
  - Undoing `add` → `removeInk`; undoing `erase` → `restoreInk`; redo does the inverse.
  - The eraser removes every stroke on the page with `strokeHit(…, radius 0.012)` as the pointer moves, and pushes them as one `erase` op per gesture.
  - `E` switches to the eraser (entering pen mode if needed).
  - History is cleared when the book closes; ops on pages not visible are never applied.

- [ ] **Step 1: Failing unit tests:**
  - push add(p2) then add(p3); `undo([2, 3])` returns the p3 op, then the p2 op.
  - `undo([4])` → null (never touches hidden pages).
  - After an undo, a new push on that page clears its redo, so `redo([2])` → null.
  - `redo` returns ops in reverse undo order.
- [ ] **Step 2: Failing e2e:**
  - Draw two strokes on page 2. `Ctrl+Z` → 1 stroke in `listForBook`; `Ctrl+Y` → 2.
  - Eraser (`E`), then drag across the first stroke → 1 stroke. `Ctrl+Z` → 2.
  - Turn to spread 4–5 and press `Ctrl+Z` → still 2 strokes.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Run the full suite: `npm test && npm run test:e2e && npm run lint && npm run build` → all green.
- [ ] **Step 7:** Commit `feat: ink eraser and undo/redo`.

---

## Done criteria for Plan 2
In `npm run dev`: select text on either stage and highlight it in five colours; click a highlight to recolour, annotate, copy or delete it; add free notes by right-click; bookmark with the ribbon or Ctrl+D; draw with a pen (or with the mouse when enabled), erase, and undo/redo. Everything survives restarts and Remove-then-re-import (when kept), and appears on the paper while it curls. All unit, e2e and perf tests pass.
