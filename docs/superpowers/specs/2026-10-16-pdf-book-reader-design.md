# PageTurn — PDF Book Reader for Windows: Design Spec

Date: 2026-10-16
Status: Draft for review
Audience: An AI coding agent (or developer) building v1 from scratch.

---

## 1. Product Summary

A Windows desktop app that opens PDFs and presents them as a **physical book**: two-page spreads, realistic paper page-curl animation, and a calm reading environment. Readers can **annotate** (highlights, notes, pen/stylus ink, bookmarks) and, when stuck, **select text and get help** in a side panel: an AI explanation that understands the surrounding page, plus web search results — without leaving the book.

Target users: students working through textbooks/papers, and leisure readers. Intended to be shipped publicly (installer, auto-update, polished UX).

### Success criteria for v1
1. Open a 500-page text PDF in < 2 s to first visible spread; page turns run at 60 fps on a mid-range laptop with integrated GPU.
2. Page turn feels physical: drag a corner to curl, release to complete or snap back; click/arrow keys also turn with animation.
3. Highlights, notes, ink and bookmarks persist across app restarts and survive moving the PDF file (identified by content hash).
4. Select text → "Explain" returns a context-aware AI answer streaming in < 3 s to first token (with a valid key); "Web" tab shows live search results in-app.
5. All annotations exportable to a Markdown file.
6. Signed-ready NSIS installer for Windows 10/11 x64.

### Explicit non-goals (v1)
- Cloud sync / accounts / backend server.
- Editing the PDF itself or writing annotations back into the PDF file (annotations live in the app's database; flattening/export-to-PDF is a later feature).
- OCR for scanned PDFs (scanned PDFs still display and accept ink/bookmarks, but text selection/highlight is unavailable — show a notice).
- EPUB or other formats.
- macOS/Linux builds (code should not block them, but they are untested).
- Local/offline AI models.

---

## 2. Tech Stack (fixed decisions)

| Concern | Choice |
|---|---|
| Shell | **Electron** (latest stable), `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for renderer |
| Build tooling | **electron-vite** + TypeScript (strict) |
| UI | **React 18** + **Zustand** for state + CSS Modules (or Tailwind — pick one, be consistent) |
| PDF rendering | **pdfjs-dist** (render pages to canvas + text layer) running in a Web Worker |
| Page curl | **Custom WebGL page-curl** renderer (see §5). Fallback: `page-flip` (StPageFlip) canvas mode if WebGL unavailable |
| Ink | Pointer Events API (pressure, tilt, pen eraser button) → `perfect-freehand` for stroke shapes |
| Storage | **better-sqlite3** in the main process |
| Secrets | Electron `safeStorage` to encrypt API keys at rest |
| AI | Provider adapters: Anthropic (default, model `claude-sonnet-5-5`), OpenAI, Google Gemini — user supplies key |
| Web search | In-app `WebContentsView` loading a search engine results page (default DuckDuckGo; configurable: Google, Bing) |
| Packaging | **electron-builder** → NSIS installer, `electron-updater` via GitHub Releases |
| Tests | **Vitest** (unit), **Playwright for Electron** (e2e) |
| Lint/format | ESLint + Prettier |

---

## 3. Architecture

```
┌──────────────────────── Main process (Node) ────────────────────────┐
│ app lifecycle · window mgmt · IPC router                            │
│ db/ (better-sqlite3, migrations)  · secrets/ (safeStorage)          │
│ ai/ (provider adapters, streaming) · web/ (WebContentsView mgr)     │
│ library/ (file import, hashing, thumbnails) · export/ (Markdown)    │
└───────────────▲─────────────────────────────────────────────────────┘
                │ typed IPC via preload (contextBridge)  window.api.*
┌───────────────┴──────────── Renderer (React) ───────────────────────┐
│ LibraryView  │ ReaderView ──┬─ BookStage (WebGL curl, spreads)      │
│              │              ├─ PageLayer (pdf.js canvas + text layer)│
│              │              ├─ AnnotationLayer (highlights, notes)  │
│              │              ├─ InkLayer (pen canvas)                │
│              │              └─ SelectionToolbar                     │
│              │ HelpPanel (Explain tab | Web tab)                    │
│              │ NotebookPanel · SettingsView                          │
│ pdf.worker (pdf.js) · pageCache (LRU of rendered bitmaps)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Rules**
- Renderer never touches the filesystem, DB, network APIs or secrets directly; everything goes through `window.api` (preload) with typed request/response contracts in `src/shared/ipc.ts`.
- API keys never enter the renderer. AI calls happen in main; tokens stream to the renderer over IPC.
- Every module has one job and a small interface (see §4). Keep files < ~300 lines; split when larger.

### Directory layout
```
src/
  main/
    index.ts            # app bootstrap, windows
    ipc/                # one file per domain: library.ts, annotations.ts, ai.ts, web.ts, settings.ts, export.ts
    db/                 # connection.ts, migrations/*.sql, repositories/*.ts
    ai/                 # provider.ts (interface), anthropic.ts, openai.ts, gemini.ts, prompt.ts
    web/                # searchView.ts
    library/            # import.ts, hash.ts, thumbnails.ts
    secrets.ts
  preload/
    index.ts            # contextBridge exposing typed window.api
  shared/
    ipc.ts              # channel names + request/response types
    types.ts            # Book, Annotation, InkStroke, Bookmark, Settings ...
  renderer/
    app/                # App.tsx, routing, theme
    library/            # LibraryView, BookCard
    reader/
      BookStage/        # webgl/ (curl shader, mesh), BookStage.tsx, useTurnGesture.ts
      pdf/              # pdfService.ts (worker wrapper), pageCache.ts, TextLayer.tsx
      annotations/      # AnnotationLayer.tsx, HighlightRects.ts, NotePopover.tsx
      ink/              # InkLayer.tsx, strokes.ts
      SelectionToolbar.tsx
    help/               # HelpPanel.tsx, ExplainTab.tsx, WebTab.tsx
    notebook/           # NotebookPanel.tsx
    settings/           # SettingsView.tsx
    stores/             # readerStore.ts, annotationStore.ts, settingsStore.ts
tests/
  unit/  e2e/  fixtures/ (sample PDFs: text-heavy, image-heavy, scanned, 1-page, 1000-page)
```

---

## 4. Components & Interfaces

### 4.1 Library
- **Import**: drag-and-drop PDFs onto window, or "Open file" dialog. Also handle `.pdf` file association (open-with / double-click from Explorer).
- Compute **SHA-256 of the first 1 MB + file size** as `bookId` (fast, stable across moves/renames). Store last known path; if missing on open, prompt user to relocate.
- Generate cover thumbnail (page 1 at 300 px wide) in background; cache in `userData/thumbnails/{bookId}.png`.
- Grid of books with cover, title (PDF metadata title, else filename), progress %, last opened. Sort: recent / title. Search by title.
- Remove from library (does not delete the file; asks whether to also delete annotations).

### 4.2 Reader — BookStage
- **Layout modes**: two-page spread (default when window aspect ≥ 1.2) and single page (narrow window or user toggle). Page 1 shown alone on the right as a cover in spread mode.
- **Fit**: book scales to fit the window with margins; zoom (Ctrl+wheel / pinch / Ctrl+±) from 50%–400%. **When zoom > fit, page turning is disabled and the page pans** (drag/scroll); zoom back to fit re-enables curl.
- **Turning inputs**: drag from any page corner/edge (curl follows pointer); click right/left third of page; ← → / PageUp/PageDown / Space; mouse wheel (debounced, one turn per notch-group); touchpad swipe.
- **Animation**: see §5. Duration ~600 ms for click/keys, eased; drag is pointer-driven; release completes if past 50% or velocity > threshold, else snaps back.
- Optional **page-turn sound** (soft paper rustle, off by default).
- **Book appearance**: subtle page-stack thickness on edges that reflects progress, center gutter shadow, paper tint options (white / cream / sepia / dark). Dark mode inverts page rendering via shader (not CSS filter) while keeping images reasonably natural (invert luminance only).
- **Navigation**: page number box (go to page), thumbnail strip toggle, PDF outline/TOC sidebar, progress slider. Remember last page per book.
- **Reduced motion**: respects OS setting; user toggle "Instant page turns".

### 4.3 PDF pipeline
- `pdfService` wraps pdf.js in a worker: `open(bookId, path) → {numPages, outline, metadata}`, `renderPage(n, scale) → ImageBitmap`, `getTextContent(n)`.
- `pageCache`: LRU of ImageBitmaps keyed `(page, scale)`; keep current spread ± 2 spreads pre-rendered. Max ~300 MB; evict LRU.
- Render at devicePixelRatio × displayed size; re-render on zoom settle (debounce 150 ms), show scaled bitmap meanwhile.
- **Text layer**: pdf.js text layer positioned over the *settled* page (hidden during curl animation) to enable native-feeling selection.
- Detect scanned pages (no text items) → show a one-time banner "This page has no selectable text."

### 4.4 Annotations
Types (in `shared/types.ts`):
```ts
type Rect = { x: number; y: number; w: number; h: number }; // normalized 0..1 page coords
type Highlight = { id; bookId; page; rects: Rect[]; text: string; color: 'yellow'|'green'|'blue'|'pink'|'purple'; noteId?: string; createdAt; updatedAt };
type Note      = { id; bookId; page; anchor: { highlightId?: string; point?: {x;y} }; body: string /* markdown */; createdAt; updatedAt };
type InkStroke = { id; bookId; page; points: [x, y, pressure][] /* normalized */; color; width; tool: 'pen'|'highlighter'; createdAt };
type Bookmark  = { id; bookId; page; label?: string; createdAt };
```
- **Coordinates are normalized to page size** so annotations are zoom/resolution independent.
- **Highlight**: select text → SelectionToolbar → pick color. Multi-line selections produce multiple rects (merge rects on same line). Click a highlight → popover: change color, add/edit note, copy, Explain, delete.
- **Notes**: attached to a highlight, or free-floating sticky icon placed by right-click → "Add note here". Markdown body, autosave on blur/500 ms debounce.
- **Ink**: toggle Pen mode (P). Pen/stylus draws; finger/mouse pans/turns in pen mode unless "Draw with mouse" is enabled. Pressure-sensitive via `perfect-freehand`. Tools: pen, highlighter (semi-transparent, multiply blend), eraser (stroke-level; pen's eraser end auto-switches). Colors ×6, widths ×3. Undo/redo (Ctrl+Z / Ctrl+Y) per page session.
- **Bookmarks**: Ctrl+D or ribbon icon on page corner; ribbon visible on bookmarked pages.
- Annotations render on both settled pages **and** inside the curl animation (bake annotation + ink into the page texture used by the WebGL stage so they turn with the paper).
- All mutations go through `annotationStore` → IPC → repository; optimistic UI, rollback + toast on failure.

### 4.5 Help Panel (when stuck)
Triggered by: selecting text → toolbar **"Help"** (or Ctrl+E). Opens right-side resizable panel (book shifts/shrinks; panel width remembered). Two tabs + one action:

**Explain tab (AI)**
- Request context sent to provider: selected text, the full text of the current page, the previous page's last ~800 chars and the next page's first ~800 chars, book title, and the PDF outline section heading containing the page (if any). Cap total context at ~12k chars.
- System prompt (in `ai/prompt.ts`): explain clearly for a reader who is stuck; define jargon; give a short example or analogy; if the selection is math/code, walk through step by step; say when the passage is ambiguous; keep under ~250 words unless asked for more.
- Streams tokens into the panel (rendered Markdown, KaTeX for math, code highlighting).
- Follow-up chat box under the answer (keeps conversation per selection; not persisted beyond the session unless the user clicks **"Save as note"**, which creates a Note attached to a highlight on the selection).
- Quick actions: "Simpler", "More detail", "Give an example", "Translate to…".
- No key configured → panel shows a friendly setup card linking to Settings. Errors (401, 429, network) → clear message + retry button. Never block reading.

**Web tab**
- A `WebContentsView` managed by main, positioned over the panel's content rect (renderer reports bounds via IPC on resize). Loads `<engine>?q=<selected text + optional book title context toggle>`.
- Mini toolbar: back, forward, reload, query edit box, engine switcher, **"Open in browser"** (`shell.openExternal`).
- Security: separate session partition `persist:websearch`, no preload, no node, `setWindowOpenHandler` → open external; block navigation to `file:` and custom protocols; disable permissions requests (camera/mic/geo) by default.

**Tab default**: Explain if an API key exists, else Web. User can set default in Settings.

### 4.6 Notebook Panel
- Left/right drawer listing all highlights, notes, bookmarks and pages-with-ink for the current book, grouped by page or by color, filterable, full-text searchable.
- Click item → jump to page (with animation) and pulse the highlight.
- **Export to Markdown**: `# {Title}` → per page `## Page N` → highlights as `> quote` with color tag, notes beneath, bookmarks listed; ink pages listed as "Page N — handwritten notes". Save via file dialog. Also "Copy all".

### 4.7 Settings
- AI: provider select, API key field (masked, stored with safeStorage; "Test key" button), model override text field.
- Web: search engine, include book title in query (toggle).
- Reading: paper tint, theme (system/light/dark), page-turn style (curl / slide / instant), sound, default layout, default help tab.
- Pen: draw with mouse, default color/width.
- Data: open data folder, export all annotations (JSON backup), import backup.
- About: version, check for updates.

### 4.8 Keyboard shortcuts
`←/→` turn · `Home/End` first/last · `Ctrl+G` go to page · `Ctrl+F` find in book (pdf.js text search, highlights hits, Enter jumps) · `H` highlight selection (last color) · `Ctrl+E` help · `P` pen mode · `E` eraser · `Ctrl+D` bookmark · `Ctrl+B` notebook · `F11` fullscreen/focus mode · `Esc` close panels.

---

## 5. Page-Curl Renderer (the hero feature)

Implement in `renderer/reader/BookStage/webgl/`.

- One full-window WebGL2 canvas. Each visible page is a **textured quad**; the turning page is a **subdivided mesh** (~40×60 grid) deformed in the vertex shader.
- Use the **cylinder-curl model**: given a fold line (from the drag point and the grabbed corner) and a cylinder radius (~page width × 0.06, shrinking as the turn progresses), vertices past the fold line wrap around the cylinder; vertices past the half-circumference flip to the back side.
- Front face samples the current page texture; back face samples the next page texture (mirrored), with slight paper translucency (blend ~5% of front through).
- Lighting: per-fragment shading from the curl normal (highlight on the bend, darker in the fold), plus a **drop shadow** cast onto the page beneath, and gutter shadow.
- Page textures = rendered PDF bitmap + annotation/ink overlay composited into an `OffscreenCanvas`, uploaded via `texImage2D(ImageBitmap)`. Re-upload only when content changes.
- Gesture → state: `{ corner: 'tr'|'br'|'tl'|'bl', progress 0..1, pointer {x,y} }`. Animations driven by `requestAnimationFrame` with spring/ease interpolation of the pointer path (click turns animate a scripted arc from corner to opposite side).
- Performance budget: ≤ 4 ms GPU per frame at 1080p. Avoid re-rendering PDF during animation; only textures for current ± 1 spread must be ready before starting a turn (if not ready, show a quick placeholder paper texture and swap in).
- Fallbacks: if WebGL2 context fails → `slide` transition (CSS transform). Handle `webglcontextlost` by rebuilding textures.
- Unit-test the pure math (fold line, vertex mapping) in Vitest; visual check via Playwright screenshot at fixed progress values.

---

## 6. Data Storage

SQLite at `%APPDATA%/PageTurn/pageturn.db`. Migrations versioned in `db/migrations/NNN_name.sql`, run on startup in a transaction.

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,          -- content hash
  path TEXT NOT NULL,
  title TEXT, author TEXT,
  num_pages INTEGER,
  last_page INTEGER DEFAULT 1,
  added_at INTEGER, last_opened_at INTEGER
);
CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, rects_json TEXT, text TEXT, color TEXT, note_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, anchor_json TEXT, body TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE ink_strokes (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, points_blob BLOB, color TEXT, width REAL, tool TEXT, created_at INTEGER);
CREATE TABLE bookmarks (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, label TEXT, created_at INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT);
CREATE INDEX idx_hl_book_page ON highlights(book_id, page);
CREATE INDEX idx_notes_book_page ON notes(book_id, page);
CREATE INDEX idx_ink_book_page ON ink_strokes(book_id, page);
CREATE INDEX idx_bm_book ON bookmarks(book_id);
CREATE VIRTUAL TABLE notes_fts USING fts5(body, content='notes', content_rowid='rowid');
```
- Ink points stored as packed Float32Array blob `[x,y,p,...]`.
- IDs: `crypto.randomUUID()`.
- Encrypted API keys stored in `userData/secrets.bin` (safeStorage), not in SQLite.
- Daily automatic JSON backup of annotations to `userData/backups/` (keep last 7).

---

## 7. IPC Contract (summary)

All in `shared/ipc.ts`; preload exposes `window.api` with these async methods (and event subscriptions):

```
library.list() / import(paths) / remove(bookId, deleteAnnotations) / relocate(bookId) / getFile(bookId) → ArrayBuffer
reader.saveProgress(bookId, page)
annotations.listForBook(bookId) / upsertHighlight / deleteHighlight / upsertNote / deleteNote
           / addInk(strokes[]) / deleteInk(ids[]) / toggleBookmark(bookId, page, label?)
ai.explain(requestId, ExplainRequest) → streams via on('ai:token', {requestId, token}) and on('ai:done'|'ai:error')
ai.followUp(requestId, message) / ai.cancel(requestId) / ai.testKey(provider, key)
web.show(query, bounds) / web.setBounds(bounds) / web.hide() / web.back() / web.forward() / web.openExternal()
settings.get() / set(partial) / setApiKey(provider, key) / hasApiKey(provider)
export.markdown(bookId) / export.backup() / import.backup()
```
Validate every IPC payload in main (zod schemas) before use.

---

## 8. Error Handling

| Situation | Behavior |
|---|---|
| Corrupt / password-protected PDF | Dialog: cannot open (password PDFs: prompt for password via pdf.js `onPassword`) |
| File moved/deleted | Library card shows "missing", click → relocate dialog; hash must match |
| Render failure on a page | Show blank paper with "Couldn't render page N" + retry; book remains usable |
| WebGL unavailable / context lost | Fallback to slide transition; rebuild on restore |
| AI: no key / invalid key / rate limit / offline / timeout (30 s) | Inline message in Explain tab with action button (Settings / Retry); Web tab still available |
| Web tab offline | Electron error page replaced with friendly offline card + retry |
| DB write fails | Toast "Couldn't save — retrying", retry 3× with backoff, keep unsaved in memory and on quit attempt warn user |
| Unhandled exceptions | Log to `userData/logs/` (electron-log), non-fatal toast; crash → restart offer |

---

## 9. Testing Strategy

- **Unit (Vitest)**: curl math, rect merging/normalization, Markdown export formatter, prompt builder & context capping, repositories (against in-memory SQLite), IPC payload validators, LRU cache.
- **Component**: SelectionToolbar, NotePopover, NotebookPanel filtering (React Testing Library).
- **E2E (Playwright Electron)**: import PDF → opens → turn pages via keys → highlight text → add note → restart app → annotation persists; notebook export file content matches snapshot; help panel opens Web tab with query; AI explain with a **mock provider** (env flag `PAGETURN_AI_MOCK=1`) streams text.
- **Performance check**: script measuring frame times during 20 automated turns on the 1000-page fixture; fail if p95 > 20 ms.
- TDD for pure logic; e2e written alongside each feature milestone.

---

## 10. Build Order (milestones)

1. **Skeleton**: electron-vite app, secure window, typed IPC, SQLite + migrations, settings store, CI lint/test.
2. **Library**: import, hashing, thumbnails, grid, open book.
3. **Basic reader**: pdf.js worker, page cache, spread/single layout, slide transition, navigation, progress saving, TOC, find.
4. **Page curl**: WebGL stage, gestures, shading/shadows, fallbacks.
5. **Annotations**: text layer selection, highlights, notes, bookmarks, baked into curl textures.
6. **Ink**: pen layer, pressure, eraser, undo/redo.
7. **Help panel**: Web tab (WebContentsView), then Explain tab with providers, streaming, follow-ups, save-as-note.
8. **Notebook + export**, backups.
9. **Polish**: themes/paper tints, sound, shortcuts, onboarding (first-run tour with sample PDF), accessibility pass.
10. **Ship**: electron-builder NSIS, file association, auto-update, code-signing hook, crash logging.

Each milestone ends with passing tests and a runnable app.

---

## 11. Security & Privacy Notes
- Only the selected text and nearby page text are sent to the user's chosen AI provider, and only when they click Explain. State this in Settings and on first use.
- No telemetry in v1.
- CSP on renderer: `default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:`.
- Keep Electron updated; enable `@electron/fuses` hardening (disable RunAsNode, enable cookie encryption, ASAR integrity).

---

## 12. Open Items for Later Versions
Cloud sync, OCR for scanned PDFs, writing annotations into the PDF, EPUB support, hosted AI subscription, flashcards from highlights, macOS build.
