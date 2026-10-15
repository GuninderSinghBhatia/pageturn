# PageTurn Plan 1 — Core Reader (Skeleton, Library, Reader, Page Curl) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Windows Electron app that imports PDFs into a library and reads them as a two-page book with a WebGL paper page-curl, navigation and saved progress.

**Architecture:** Electron main process owns SQLite, filesystem and hashing; the React renderer talks to it only through a typed `window.api` preload bridge. pdf.js renders pages in a worker into an LRU bitmap cache; a WebGL2 `BookStage` composites spreads and deforms the turning page with a cylinder-curl vertex shader, falling back to a slide transition.

**Tech Stack:** Electron (latest stable), electron-vite, TypeScript strict, React 18, Zustand, CSS Modules, pdfjs-dist, better-sqlite3, zod, Vitest, @testing-library/react, Playwright (`_electron`), ESLint + Prettier.

**Spec:** `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md` (sections §2, §3, §4.1–4.3, §4.8 subset, §5, §6 `books`/`settings`, §7 `library`/`reader`/`settings`, §8 PDF/WebGL rows, §9, §10 milestones 1–4).

**Later plans (not in scope here):** Plan 2 Annotations + Ink (milestones 5–6), Plan 3 Help panel (7), Plan 4 Notebook/export/polish/ship (8–10).

## Global Constraints

- App name `PageTurn`; data dir `%APPDATA%/PageTurn/` (Electron `app.getPath('userData')`), DB file `pageturn.db`.
- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer CSP: `default-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:`.
- Renderer never touches fs/DB/network; all through `window.api`. Every IPC payload validated in main with zod.
- `bookId` = SHA-256 hex of (first 1 MB of file bytes + file size as decimal string).
- Page coordinates for any overlay are normalized 0..1.
- Thumbnails: page 1 at 300 px wide → `userData/thumbnails/{bookId}.png`.
- Page cache budget ~300 MB; keep current spread ± 2 spreads rendered.
- Re-render on zoom settle debounce 150 ms; zoom range 50%–400%.
- Turn animation ~600 ms for click/keys; drag release completes if progress > 0.5 or velocity above threshold.
- Spread layout default when window aspect ≥ 1.2; page 1 shown alone on the right in spread mode.
- Curl mesh ~40×60 grid; cylinder radius ≈ pageWidth × 0.06, shrinking with progress; back-face translucency ~5%.
- Performance: first spread of a 500-page text PDF < 2 s; turn-perf p95 frame time ≤ 20 ms on 1000-page fixture.
- Files kept < ~300 lines.
- IDs via `crypto.randomUUID()`.

## Review Focus

1. **Password-protected PDF** — prompt for password via pdf.js `onPassword`; wrong password re-prompts; cancel returns to library without crash. (Task 7 test.)
2. **Book file moved/deleted after import** — library card shows "missing"; relocate accepts only a file whose hash matches. (Task 4 test.)
3. **Importing the same PDF twice (or renamed copy)** — no duplicate row; path updated. (Task 4 test.)
4. **Odd page counts / 1-page PDF in spread mode** — last page shown alone, turning past end is a no-op, no blank-texture crash. (Task 8 test.)
5. **Rapid repeated key presses during an animation** — turns queue or snap the current turn to completion; page index never desyncs from what's displayed. (Task 10 test.)

---

## File Structure

```
package.json, electron.vite.config.ts, tsconfig*.json, .eslintrc.cjs, .prettierrc, vitest.config.ts, playwright.config.ts
src/shared/types.ts            Book, Settings, LayoutMode, PageTurnStyle
src/shared/ipc.ts              channel names, zod schemas, request/response types, Api interface
src/main/index.ts              bootstrap, window, CSP, file-association arg
src/main/db/connection.ts      open DB, run migrations
src/main/db/migrations/001_init.sql   books + settings tables
src/main/db/repositories/books.ts     BooksRepo
src/main/db/repositories/settings.ts  SettingsRepo
src/main/library/hash.ts       computeBookId
src/main/library/import.ts     importFiles, relocate
src/main/ipc/library.ts, reader.ts, settings.ts   handlers
src/preload/index.ts           contextBridge window.api
src/renderer/app/App.tsx, routes, theme.css
src/renderer/library/LibraryView.tsx, BookCard.tsx, thumbnails.ts
src/renderer/reader/pdf/pdfService.ts, pageCache.ts
src/renderer/reader/layout.ts          spread math
src/renderer/reader/ReaderView.tsx, NavBar.tsx, TocSidebar.tsx, FindBar.tsx
src/renderer/reader/BookStage/BookStage.tsx, SlideStage.tsx, useTurnGesture.ts, turnController.ts
src/renderer/reader/BookStage/webgl/curlMath.ts, shaders.ts, renderer.ts, textures.ts
src/renderer/stores/readerStore.ts, libraryStore.ts, settingsStore.ts
tests/unit/**, tests/e2e/**, tests/fixtures/{text-500.pdf,text-1000.pdf,one-page.pdf,odd-3.pdf,scanned.pdf,password.pdf}
scripts/make-fixtures.ts       generates fixtures with pdf-lib
```

---

### Task 1: Project skeleton, secure window, tooling

**Files:**
- Create: config files above, `src/main/index.ts`, `src/preload/index.ts` (empty api), `src/renderer/app/App.tsx`, `scripts/make-fixtures.ts`, `tests/e2e/launch.spec.ts`

**Interfaces:**
- Produces: `npm run dev | build | test | test:e2e | lint | fixtures`; e2e helper `launchApp(): Promise<{app: ElectronApplication, page: Page}>` in `tests/e2e/helpers.ts` (launches with env `PAGETURN_USER_DATA=<tmpdir>`, which main honours via `app.setPath('userData', ...)`).

- [ ] **Step 1:** Scaffold with electron-vite React-TS template; add deps (pdfjs-dist, better-sqlite3, zod, zustand, pdf-lib dev, vitest, @testing-library/react, jsdom, @playwright/test, electron-rebuild). Add `postinstall: electron-builder install-app-deps`.
- [ ] **Step 2:** Write `scripts/make-fixtures.ts` generating the six fixtures with pdf-lib (text pages with "Page N" + lorem paragraphs; `scanned.pdf` = image-only page; `password.pdf` encrypted with password `test`; for encryption use qpdf if pdf-lib can't — commit generated binaries). Run `npm run fixtures`; expect 6 files in `tests/fixtures`.
- [ ] **Step 3: Write failing e2e** `launch.spec.ts`: window opens, title is `PageTurn`, `await page.evaluate(() => typeof (window as any).require)` is `'undefined'`, and `<meta http-equiv="Content-Security-Policy">` content equals the Global Constraints CSP.
- [ ] **Step 4:** Run `npm run build && npx playwright test tests/e2e/launch.spec.ts` → FAIL.
- [ ] **Step 5:** Implement main window with the security flags and CSP meta in `index.html`; title `PageTurn`; `PAGETURN_USER_DATA` override.
- [ ] **Step 6:** Rerun → PASS. `npm run lint` clean.
- [ ] **Step 7:** `git init` (if needed) and commit `chore: scaffold PageTurn electron app`.

### Task 2: Shared types and typed IPC contract

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`; Test: `tests/unit/shared/ipc.test.ts`

**Interfaces:**
- Produces:
```ts
type Book = { id: string; path: string; title: string | null; author: string | null; numPages: number | null;
  lastPage: number; addedAt: number; lastOpenedAt: number | null; missing: boolean; thumbnailUrl: string | null };
type LayoutMode = 'auto' | 'spread' | 'single';
type PageTurnStyle = 'curl' | 'slide' | 'instant';
type PaperTint = 'white' | 'cream' | 'sepia' | 'dark';
type Settings = { theme: 'system'|'light'|'dark'; paperTint: PaperTint; pageTurnStyle: PageTurnStyle; layout: LayoutMode; turnSound: boolean };
const DEFAULT_SETTINGS: Settings = { theme:'system', paperTint:'cream', pageTurnStyle:'curl', layout:'auto', turnSound:false };
interface Api {
  library: { list(): Promise<Book[]>; import(paths: string[]): Promise<Book[]>; openDialog(): Promise<Book[]>;
    remove(bookId: string): Promise<void>; relocate(bookId: string): Promise<Book | null>;
    getFile(bookId: string): Promise<ArrayBuffer>; saveThumbnail(bookId: string, png: ArrayBuffer): Promise<string>;
    updateMeta(bookId: string, meta: { title?: string|null; author?: string|null; numPages: number }): Promise<void>;
    onOpenRequest(cb: (book: Book) => void): () => void };
  reader: { saveProgress(bookId: string, page: number): Promise<void> };
  settings: { get(): Promise<Settings>; set(partial: Partial<Settings>): Promise<Settings> };
}
const Channels = { libraryList:'library:list', ... } // one const per method
```
  plus zod schemas `BookIdSchema` (64 hex chars), `PageSchema` (int ≥ 1), `SettingsPartialSchema`, `PathsSchema` (non-empty array of strings ending `.pdf`, case-insensitive).

- [ ] **Step 1: Failing tests:** `BookIdSchema` rejects `'abc'` and accepts 64-hex; `PageSchema` rejects `0`, `1.5`; `SettingsPartialSchema` rejects `{paperTint:'neon'}`; `PathsSchema` rejects `['a.txt']`, accepts `['C:\\x\\B.PDF']`.
- [ ] **Step 2:** `npx vitest run tests/unit/shared` → FAIL.
- [ ] **Step 3:** Implement types/schemas.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat: shared types and IPC contract`.

### Task 3: SQLite, migrations, repositories

**Files:**
- Create: `src/main/db/connection.ts`, `migrations/001_init.sql`, `repositories/books.ts`, `repositories/settings.ts`; Test: `tests/unit/main/db.test.ts`

**Interfaces:**
- Consumes: `Book`, `Settings`, `DEFAULT_SETTINGS` (Task 2).
- Produces: `openDb(file: string | ':memory:'): Database` (runs pending migrations in a transaction, tracks `PRAGMA user_version`, enables `foreign_keys`); `class BooksRepo { constructor(db); upsert(row: {id; path; title?; author?; numPages?}): void; get(id): BookRow|null; list(): BookRow[] /* last_opened_at DESC NULLS LAST, then added_at DESC */; setPath(id, path): void; setProgress(id, page): void /* also sets last_opened_at=now */; updateMeta(id, meta): void; remove(id): void }`; `class SettingsRepo { get(): Settings /* merges stored over DEFAULT_SETTINGS */; set(partial): Settings }`. `BookRow` = `Book` minus `missing`/`thumbnailUrl`.
- Schema: exactly the spec §6 `books` and `settings` tables (other tables arrive in Plan 2).

- [ ] **Step 1: Failing tests** (in-memory DB): migrations idempotent (open twice → `user_version` 1); upsert then get round-trips; upsert existing id keeps `last_page` and `added_at` but updates `path`; `list` ordering; `setProgress(id, 42)` sets `last_page` 42 and `last_opened_at` non-null; settings `get()` on empty equals `DEFAULT_SETTINGS`; `set({paperTint:'sepia'})` persists.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Migration files loaded via Vite `import.meta.glob('./migrations/*.sql', { as: 'raw', eager: true })`.
- [ ] **Step 4:** Run → PASS (if better-sqlite3 ABI mismatch under Vitest, run tests with `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs` via `test:main` script).
- [ ] **Step 5:** Commit `feat: sqlite with books/settings repositories`.

### Task 4: Library import, hashing, relocate, IPC + preload

**Files:**
- Create: `src/main/library/hash.ts`, `src/main/library/import.ts`, `src/main/ipc/library.ts`, `src/main/ipc/reader.ts`, `src/main/ipc/settings.ts`; Modify: `src/preload/index.ts`, `src/main/index.ts`; Test: `tests/unit/main/library.test.ts`

**Interfaces:**
- Consumes: repos (Task 3), schemas + `Api` (Task 2).
- Produces: `computeBookId(path: string): Promise<string>`; `importFiles(repo, paths): Promise<BookRow[]>`; `relocateBook(repo, id, newPath): Promise<'ok'|'mismatch'>`; `toBook(row, fsExists, thumbDir): Book`; `registerIpc(db, win)`. Preload exposes the full `Api` on `window.api`. Main handles `second-instance` and initial argv `.pdf` paths → import → send `library:openRequest`.
- `getFile` reads the file and returns its ArrayBuffer; throws `BookMissingError` if absent. `saveThumbnail` writes `{bookId}.png` and returns a `file://` URL (add `img-src file:` is NOT allowed by CSP — instead return a `data:image/png;base64,...` URL; store file on disk, `toBook` reads it as data URL).

- [ ] **Step 1: Failing tests:** `computeBookId` on `text-500.pdf` equals a recomputed SHA-256(first 1 MB + size) and is identical for a renamed copy; importing the same file twice yields one row; importing a renamed copy updates `path`; `relocateBook` with `odd-3.pdf` for a `text-500` id returns `'mismatch'` and leaves path unchanged; `toBook` marks `missing: true` when file absent.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `fs.promises.open` + read 1 MB, `crypto.createHash('sha256')`. Each IPC handler parses args with its zod schema, else throws `Error('Invalid payload')`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: library import, hashing, relocate, IPC bridge`.

### Task 5: pdf.js service and page cache

**Files:**
- Create: `src/renderer/reader/pdf/pdfService.ts`, `pageCache.ts`; Test: `tests/unit/renderer/pageCache.test.ts`, `tests/unit/renderer/pdfService.test.ts`

**Interfaces:**
- Produces:
```ts
class PageCache { constructor(maxBytes = 300 * 1024 * 1024);
  get(page: number, scale: number): ImageBitmap | undefined; set(page, scale, bmp: ImageBitmap): void;
  has(page, scale): boolean; clear(): void; get bytes(): number }   // bytes = w*h*4; evict LRU, call bmp.close()
interface OpenedDoc { numPages: number; outline: OutlineItem[]; metadata: { title: string|null; author: string|null };
  pageSize(page: number): { width: number; height: number };   // PDF points, cached after first load
  renderPage(page: number, scale: number): Promise<ImageBitmap>;  // uses cache
  getText(page: number): Promise<{ str: string; transform: number[] }[]>;
  hasText(page: number): Promise<boolean>;
  destroy(): void }
type OutlineItem = { title: string; page: number | null; children: OutlineItem[] };
function openPdf(data: ArrayBuffer, opts: { onPassword: (retry: boolean) => Promise<string | null> }): Promise<OpenedDoc>;  // null → rejects PasswordCancelledError
```
  Worker: `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`. Rendering to `OffscreenCanvas` then `transferToImageBitmap()`.

- [ ] **Step 1: Failing tests:** cache evicts least-recently-used when over budget (fake bitmaps `{width, height, close: vi.fn()}`), calls `close()` on evicted; `get` refreshes recency. pdfService (node, pdfjs legacy build, `renderPage` skipped): `text-500.pdf` → `numPages` 500, page 1 `hasText` true; `scanned.pdf` page 1 `hasText` false; `password.pdf` with `onPassword` returning `'wrong'` then `'test'` opens and `onPassword` called with `retry=true` second time; returning `null` rejects `PasswordCancelledError`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: pdf.js service and LRU page cache`.

### Task 6: Library view (renderer)

**Files:**
- Create: `src/renderer/stores/libraryStore.ts`, `settingsStore.ts`, `library/LibraryView.tsx`, `BookCard.tsx`, `thumbnails.ts`, `app/App.tsx` routing (`'library' | {reader: bookId}` in a tiny store, no router lib); Test: `tests/e2e/library.spec.ts`, `tests/unit/renderer/LibraryView.test.tsx`

**Interfaces:**
- Consumes: `window.api.library.*`, `openPdf` (for thumbnails/meta).
- Produces: `useLibraryStore` with `books`, `refresh()`, `importPaths(paths)`, `openBook(id)`; `generateThumbnail(book): Promise<void>` (render page 1 at width 300, PNG via `convertToBlob`, `saveThumbnail`, `updateMeta` with title/author/numPages); `useNav()` → `{ view, goLibrary(), goReader(bookId) }`.
- UI: grid of cards (cover, title = metadata title else filename without extension, progress `lastPage/numPages` as %, "Missing" badge with Relocate button), sort select (Recent | Title), title search input, "Open PDF" button, window-wide drop zone (`dataTransfer.files[i].path` via `webUtils.getPathForFile` exposed in preload as `api.library.pathForFile(file)` — add to `Api`). Remove via card context menu.

- [ ] **Step 1: Failing component test:** with mocked `window.api.library.list` returning 3 books, search "zeta" shows only matching card; sort Title orders alphabetically; missing book shows "Missing".
- [ ] **Step 2: Failing e2e:** import `text-500.pdf` via `api.library.import` from test (evaluate), card appears with cover `<img>` within 5 s; restart app → card still there.
- [ ] **Step 3:** Run both → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat: library grid with import, search, sort, thumbnails`.

### Task 7: Reader shell — layout math, navigation, progress, TOC, find, password

**Files:**
- Create: `src/renderer/reader/layout.ts`, `stores/readerStore.ts`, `reader/ReaderView.tsx`, `NavBar.tsx`, `TocSidebar.tsx`, `FindBar.tsx`, `reader/BookStage/SlideStage.tsx`; Test: `tests/unit/renderer/layout.test.ts`, `tests/unit/renderer/readerStore.test.ts`, `tests/e2e/reader.spec.ts`

**Interfaces:**
- Consumes: `openPdf`, `OpenedDoc`, `api.reader.saveProgress`, settings store.
- Produces:
```ts
type Spread = { left: number | null; right: number | null };   // 1-based page numbers
function resolveLayout(mode: LayoutMode, aspect: number): 'spread' | 'single';   // auto: aspect >= 1.2 → spread
function spreadFor(page: number, numPages: number, layout: 'spread'|'single'): Spread;   // spread: page 1 → {left:null,right:1}; then {2,3},{4,5}...; last even page alone on left if numPages even
function nextSpreadStart(page, numPages, layout): number | null; function prevSpreadStart(page, numPages, layout): number | null;
function fitPageSize(pageSize: {width;height}, viewport: {width;height}, layout, margin = 32): { width; height };  // per-page CSS px
useReaderStore: { doc: OpenedDoc|null; bookId; page; layout; zoom /* 0.5..4, 1 = fit */; turning: boolean;
  open(bookId): Promise<void>; goTo(page): void; next(): void; prev(): void; setZoom(z): void; close(): void }
```
  `goTo` clamps 1..numPages, snaps to spread start, debounces `saveProgress` by 500 ms. `SlideStage` renders the current spread as two `<canvas>` with a CSS translate transition (used for `slide`/`instant` style and as WebGL fallback). Book reopens at `lastPage`.
- NavBar: back to library, page box (Ctrl+G focuses), progress slider, layout toggle, TOC toggle, zoom. Keys: ←/→, PageUp/PageDown, Space, Home/End, Ctrl+±, Ctrl+wheel, Ctrl+F, F11, Esc. Zoom > 1 disables turning and enables panning via scroll/drag.
- FindBar: searches `getText` for all pages lazily (incremental, cancellable), lists hit count, Enter jumps to next hit page.
- Password prompt: modal input, wraps `onPassword`; cancel → `goLibrary()`.
- Scanned page: one-time banner "This page has no selectable text."
- Render failure: blank paper with "Couldn't render page N" + Retry.

- [ ] **Step 1: Failing unit tests (layout):** `spreadFor(1,500,'spread')` = `{left:null,right:1}`; `spreadFor(3,500,'spread')` = `{left:2,right:3}`; `spreadFor(500,500,'spread')` = `{left:500,right:null}`; `spreadFor(1,1,'spread')` = `{left:null,right:1}` and `nextSpreadStart(1,1,'spread')` = `null`; `odd-3`: `nextSpreadStart(2,3,'spread')` = `null`; `resolveLayout('auto',1.19)` = `'single'`, `1.2` → `'spread'`; `fitPageSize` keeps aspect and fits two pages + margins.
- [ ] **Step 2: Failing store tests:** `goTo(9999)` clamps to last; `next()` at end is no-op; `saveProgress` called once after three rapid `goTo`s (fake timers, 500 ms).
- [ ] **Step 3: Failing e2e:** open `text-500.pdf`, first spread canvas painted in < 2000 ms (measure from click to `data-ready` attribute); press → three times → page box shows 7; restart → reopens at page 7; `password.pdf` prompts, `test` opens; Ctrl+F "Page 250" jumps to 250.
- [ ] **Step 4:** Run → FAIL. **Step 5:** Implement. **Step 6:** Run → PASS.
- [ ] **Step 7:** Commit `feat: reader shell with navigation, progress, TOC, find`.

### Task 8: Prefetching render pipeline for spreads

**Files:**
- Create: `src/renderer/reader/pdf/prefetch.ts`; Modify: `ReaderView.tsx`; Test: `tests/unit/renderer/prefetch.test.ts`

**Interfaces:**
- Consumes: `OpenedDoc.renderPage`, `spreadFor`, `nextSpreadStart`, `prevSpreadStart`.
- Produces: `pagesToPrefetch(page, numPages, layout, radius = 2): number[]` (current spread first, then alternating forward/back spreads, de-duplicated, in range); `class Prefetcher { constructor(doc, scaleFor: (page)=>number); update(page, layout): void /* cancels stale queued jobs */; ready(page): boolean }`. Scale = devicePixelRatio × fitted CSS width / pdf width; on zoom settle (150 ms debounce) re-render visible pages at new scale while showing the scaled old bitmap.

- [ ] **Step 1: Failing tests:** `pagesToPrefetch(10,500,'spread')` starts `[10,11]` then `12,13,8,9,14,15,6,7`; `pagesToPrefetch(1,1,'spread')` = `[1]`; `pagesToPrefetch(3,3,'spread')` = `[2,3,1]`; Prefetcher with a fake doc renders at most 2 concurrently and drops queued jobs from a prior `update`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: spread prefetching and zoom re-render`.

### Task 9: Page-curl math (pure, TDD)

**Files:**
- Create: `src/renderer/reader/BookStage/webgl/curlMath.ts`; Test: `tests/unit/renderer/curlMath.test.ts`

**Interfaces:**
- Produces (all in page-local units where the turning page spans x∈[0,1], y∈[0,aspect]):
```ts
type Corner = 'tr' | 'br' | 'tl' | 'bl';
type Vec2 = { x: number; y: number };
type Fold = { origin: Vec2; dir: Vec2 /* unit, along fold line */; normal: Vec2 /* unit, toward the lifted side */; radius: number };
function foldFromDrag(corner: Corner, pointer: Vec2, aspect: number, baseRadius = 0.06): Fold;   // fold = perpendicular bisector of corner→pointer; radius = baseRadius * (1 - 0.7*progress)
function progressFromPointer(corner: Corner, pointer: Vec2): number;   // 0 at corner, 1 when pointer reaches mirrored position; clamped 0..1
function curlVertex(p: Vec2, fold: Fold): { pos: [number, number, number]; normal: [number, number, number]; back: boolean };
function scriptedPath(corner: Corner, t: number, aspect: number): Vec2;   // click/keys turn: eased arc from corner to mirrored corner, t∈[0,1], easeInOutCubic, lift of 0.15*aspect at midpoint
function shouldComplete(progress: number, velocityX: number, dir: 1 | -1): boolean;   // progress > 0.5 || velocityX*dir > 1.5 (page-widths/s)
```
  Cylinder curl: let d = signed distance of p past the fold line along `normal`. If d ≤ 0 → unchanged (z=0, normal (0,0,1)). If 0 < d ≤ πr → angle θ=d/r, pos = fold-projection + normal·(r·sinθ), z = r·(1−cosθ). If d > πr → flipped flat: pos = projection − normal·(d − πr), z = 2r, `back: true`. `back` true when θ > π/2. The same formula is mirrored into the vertex shader in Task 10.

- [ ] **Step 1: Failing tests:** point before fold unchanged; point at d = πr/2 has z = r and back false; point at d = πr + 0.1 lies at mirrored x with z ≈ 2r and back true; `progressFromPointer('br', cornerPos)` = 0, at mirrored = 1; `scriptedPath` at t=0 = corner, t=1 = mirrored corner, monotonic in x; `shouldComplete(0.4, 2, 1)` = true, `(0.4, 0.2, 1)` = false, `(0.6, -3, 1)` = true (progress wins).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: page curl geometry`.

### Task 10: WebGL BookStage, gestures, turn controller, fallback

**Files:**
- Create: `webgl/shaders.ts`, `webgl/renderer.ts`, `webgl/textures.ts`, `BookStage/BookStage.tsx`, `useTurnGesture.ts`, `turnController.ts`; Modify: `ReaderView.tsx`; Test: `tests/unit/renderer/turnController.test.ts`, `tests/e2e/curl.spec.ts`, `tests/e2e/perf.spec.ts`

**Interfaces:**
- Consumes: `curlMath` (Task 9), `Prefetcher`/`PageCache` bitmaps (Tasks 5, 8), `useReaderStore` (`next/prev/turning`), settings `pageTurnStyle`, `paperTint`.
- Produces:
```ts
class CurlRenderer { constructor(canvas: HTMLCanvasElement);   // throws WebGLUnavailableError if no webgl2
  setPages(textures: { leftUnder?: ImageBitmap; rightUnder?: ImageBitmap; front?: ImageBitmap; back?: ImageBitmap; staticLeft?: ImageBitmap; staticRight?: ImageBitmap }): void;
  setLayout(rects: { left: DOMRect | null; right: DOMRect | null }): void;
  setTint(t: PaperTint): void;   // dark = luminance inversion in fragment shader
  draw(state: { corner: Corner; pointer: Vec2 } | null): void;   // null = static spread
  onContextLost(cb: () => void): void; dispose(): void }
type TurnState = { phase: 'idle' } | { phase: 'dragging'; dir: 1|-1; corner; pointer } | { phase: 'animating'; dir; corner; from: Vec2; to: 'complete'|'cancel'; t: number };
class TurnController { constructor(opts: { canTurn: (dir) => boolean; commit: (dir) => void; durationMs = 600; now = performance.now });
  turn(dir: 1|-1): void;   // if animating, finish current immediately (commit) then start new; queue depth max 1
  pointerDown(corner, p): void; pointerMove(p, velocityX): void; pointerUp(): void; tick(now): TurnState }
```
- Shader: mesh 40×60 subdivided quad, vertex shader implements `curlVertex`; fragment: Lambert from curl normal + bend highlight, front samples `front`, back samples mirrored `back` blended with 5% front; drop shadow quad under the curl; gutter shadow on static spread; page-stack edge thickness proportional to progress `page/numPages`.
- Gesture: pointer down within 15% of page corners/edges starts drag; click on outer third turns; wheel debounced 250 ms; disabled when `zoom > 1`; `prefers-reduced-motion` or style `instant` → no animation; style `slide` or `WebGLUnavailableError`/context lost → `SlideStage`. Starting a turn whose next textures aren't ready uses a plain paper-colored placeholder and swaps when ready.
- Text layer (for Plan 2) not rendered here; just expose `data-settled` on the stage when idle.

- [ ] **Step 1: Failing controller tests (fake clock):** `turn(1)` → animating, after 600 ms `commit(1)` called once and idle; two `turn(1)` calls 100 ms apart → `commit` called twice total and final idle with no extra queued; `canTurn` false → stays idle; drag with progress 0.3 & slow release → cancel, `commit` never called; progress 0.7 release → commit.
- [ ] **Step 2: Failing e2e `curl.spec.ts`:** open `text-500.pdf`, press → five times rapidly, wait for `data-settled`, page box shows 11 (Review Focus 5); screenshot of stage mid-drag (use `page.mouse` from bottom-right corner to center, hold) matches baseline `curl-mid.png` (maxDiffPixelRatio 0.02); launching with `--disable-gpu` flag (`PAGETURN_DISABLE_WEBGL=1` env forcing fallback) still turns pages via slide.
- [ ] **Step 3: Failing perf e2e:** on `text-1000.pdf`, record `requestAnimationFrame` deltas during 20 automated → turns; assert p95 ≤ 20 ms.
- [ ] **Step 4:** Run → FAIL. **Step 5:** Implement. **Step 6:** Run → PASS (update screenshot baseline once by `--update-snapshots` after visual check by human).
- [ ] **Step 7:** Commit `feat: WebGL page curl stage with gestures and fallback`.

### Task 11: Settings view (reading subset) and theming

**Files:**
- Create: `src/renderer/settings/SettingsView.tsx`, `src/renderer/app/theme.css`; Modify: `App.tsx`, `NavBar.tsx` (gear icon); Test: `tests/unit/renderer/SettingsView.test.tsx`

**Interfaces:**
- Consumes: `api.settings`, `useSettingsStore`.
- Produces: settings controls for theme, paper tint, page-turn style (curl/slide/instant), default layout, turn sound (stored only; sound asset arrives in Plan 4). Theme via `data-theme` on `<html>` with CSS tokens; `system` follows `prefers-color-scheme`.

- [ ] **Step 1: Failing test:** changing turn style to Slide calls `api.settings.set({pageTurnStyle:'slide'})` and store updates; theme Dark sets `document.documentElement.dataset.theme = 'dark'`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS. Run full `npm test && npm run test:e2e && npm run lint` → all green.
- [ ] **Step 5:** Commit `feat: reading settings and theming`.

---

## Done criteria for Plan 1
`npm run dev` opens PageTurn; dragging a PDF in adds it to the library; opening it shows a two-page book that curls realistically on drag/click/keys, remembers its page, supports TOC, find, zoom/pan, single/spread layout, password PDFs, and falls back to slide without WebGL. All unit, e2e and perf tests pass.
