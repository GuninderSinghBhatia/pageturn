# PageTurn Plan 4 — Notebook, Export, Backups, Polish & Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Notebook panel with Markdown export, JSON backups (auto + manual), polish (paper tints, turn sound, shortcuts, onboarding, accessibility, logging) and ship a Windows NSIS installer with PDF file association and auto-update.

**Architecture:** Export and backup logic are pure functions in main over repository data, exposed via IPC; the Notebook is a renderer drawer reading the existing annotation store. Packaging uses electron-builder + electron-updater (GitHub Releases), hardened with `@electron/fuses`; logging via electron-log.

**Tech Stack:** electron-builder, electron-updater, @electron/fuses, electron-log, zod, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md` (§4.6, §4.7 Data/About/Pen/Reading, §4.8, §6 backups, §7 `export`, §8 DB-write + unhandled rows, §10 milestones 8–10, §11).

**Prerequisites:** Plans 1 and 2 complete (Notebook/export need highlights, notes, ink, bookmarks). Plan 3 optional (only Settings tabs it adds).

## Global Constraints

- Plan 2 types used as-is: `Highlight { id; bookId; page; rects; text; color: 'yellow'|'green'|'blue'|'pink'|'purple'; noteId?; createdAt; updatedAt }`, `Note { id; bookId; page; anchor; body; createdAt; updatedAt }`, `InkStroke`, `Bookmark { id; bookId; page; label?; createdAt }`.
- Markdown export shape: `# {Title}` → per page with content `## Page N` → highlights as `> quote` with color tag, attached note beneath, free notes, bookmarks; ink pages as `Page N — handwritten notes`.
- Daily automatic JSON backup to `userData/backups/`, keep last 7.
- DB write failure: toast "Couldn't save — retrying", retry 3× with backoff, keep unsaved in memory, warn on quit.
- Logs to `userData/logs/` via electron-log; non-fatal toast on unhandled errors; crash → restart offer.
- No telemetry.
- Installer: NSIS, Windows 10/11 x64, `.pdf` file association (not default handler — appears in "Open with"), auto-update from GitHub Releases, code-signing hook via env (`CSC_LINK`, `CSC_KEY_PASSWORD`), build must succeed unsigned.
- Fuses: RunAsNode off, EnableCookieEncryption on, EnableNodeOptionsEnvironmentVariable off, EnableNodeCliInspectArguments off, EnableEmbeddedAsarIntegrityValidation on, OnlyLoadAppFromAsar on.
- Turn sound off by default; respects reduced motion (no sound when turns are instant).
- Shortcuts (full set): `←/→` turn · `Home/End` · `Ctrl+G` · `Ctrl+F` · `H` highlight · `Ctrl+E` help · `P` pen · `E` eraser · `Ctrl+D` bookmark · `Ctrl+B` notebook · `F11` focus mode · `Esc` close panels. Single-letter shortcuts ignored while typing in inputs/contenteditable.

## Review Focus

1. **Book with no annotations exported** — file contains just `# {Title}` and the line `_No highlights or notes yet._`, not an empty file or crash. (Task 1 test.)
2. **Highlight text/notes containing Markdown or newlines (`#`, `>`, `*`, multi-paragraph)** — export remains valid: every line of a quote prefixed with `> `, leading `#` escaped. (Task 1 test.)
3. **Importing a backup that overlaps existing data or is from a newer schema version** — merge by id keeping the newer `updatedAt`; unknown `version` rejected with message, nothing written. (Task 3 test.)
4. **Single-letter shortcuts while typing a note or search** — typing "p" in a note does not toggle pen mode. (Task 5 test.)
5. **App launched by double-clicking a PDF while already running** — existing window focuses and opens that book; no second instance. (Task 7 test.)

---

## File Structure

```
src/main/export/markdown.ts          renderMarkdown
src/main/export/backup.ts            createBackup, parseBackup, mergeBackup, rotateBackups, scheduleDailyBackup
src/main/ipc/export.ts               handlers
src/main/db/retry.ts                 withRetry
src/main/logging.ts                  electron-log setup, crash handling
src/main/updater.ts                  auto-update wiring
src/renderer/notebook/NotebookPanel.tsx, notebookModel.ts
src/renderer/app/Toasts.tsx, shortcuts.ts, Onboarding.tsx
src/renderer/reader/sound.ts, assets/page-turn.mp3
src/renderer/settings/DataSettings.tsx, AboutSettings.tsx, PenSettings.tsx
electron-builder.yml, build/icon.ico, scripts/fuses.cjs (afterPack)
tests/unit/main/{markdown,backup,retry}.test.ts
tests/unit/renderer/{notebookModel,shortcuts}.test.ts
tests/e2e/{notebook,backup,onboarding,singleInstance}.spec.ts
```

---

### Task 1: Markdown export

**Files:**
- Create: `src/main/export/markdown.ts`, `src/main/ipc/export.ts`; Modify: preload, `shared/ipc.ts`
- Test: `tests/unit/main/markdown.test.ts`

**Interfaces:**
- Consumes: Plan 2 repositories `listForBook(bookId) → { highlights; notes; ink; bookmarks }`, `BooksRepo.get`.
- Produces:
```ts
type BookAnnotations = { title: string; highlights: Highlight[]; notes: Note[]; inkPages: number[]; bookmarks: Bookmark[] };
function renderMarkdown(a: BookAnnotations): string;
function quoteBlock(text: string): string;   // every line prefixed "> "
function escapeLineStart(text: string): string;   // escapes leading #, >, -, +, digits+'.' at line starts with backslash
// Api: export.markdown(bookId): Promise<{ saved: boolean; path?: string }> (shows save dialog, default `{title}-notes.md`); export.markdownText(bookId): Promise<string> (for "Copy all")
```
  Per page ascending, within page: bookmarks line `🔖 Bookmark{: label}`, then highlights by `createdAt` as `quoteBlock(text)` + ` — *{color}*` on the last quote line, attached note body (escaped) on the next line(s), then free notes as `📝 {body}`, then `Page N — handwritten notes` if in `inkPages`. Pages with nothing are skipped. Ends with single trailing newline.

- [ ] **Step 1: Failing tests:** empty → `'# My Book\n\n_No highlights or notes yet._\n'` (Review Focus 1); snapshot of a fixture with 2 pages (highlight+note on p3, bookmark+ink on p7, free note on p7) matches expected string exactly (write it inline); highlight text `"line one\nline two"` → `> line one\n> line two`; note body `"# not heading"` → `\# not heading` (Review Focus 2); pages sorted numerically (p10 after p9).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: markdown export of annotations`.

### Task 2: Notebook panel

**Files:**
- Create: `src/renderer/notebook/notebookModel.ts`, `NotebookPanel.tsx`; Modify: `ReaderView.tsx`, `NavBar.tsx`
- Test: `tests/unit/renderer/notebookModel.test.ts`, `tests/e2e/notebook.spec.ts`

**Interfaces:**
- Consumes: Plan 2 `useAnnotationStore` (`highlights`, `notes`, `bookmarks`, `inkPages`), `useReaderStore.goTo`, `api.export.*`.
- Produces:
```ts
type NotebookItem = { kind: 'highlight'|'note'|'bookmark'|'ink'; id: string; page: number; color?: Highlight['color']; text: string; noteText?: string; createdAt: number };
type NotebookFilter = { query: string; kinds: Set<NotebookItem['kind']>; colors: Set<Highlight['color']>; groupBy: 'page' | 'color' };
function toItems(store: {...}): NotebookItem[];
function filterItems(items: NotebookItem[], f: NotebookFilter): NotebookItem[];   // query: case-insensitive match in text or noteText
function groupItems(items, by): { key: string; items: NotebookItem[] }[];   // page → "Page N" ascending; color → fixed order yellow,green,blue,pink,purple
// readerStore addition: pulse(highlightId: string): void  (AnnotationLayer animates a 1.2 s glow)
```
  Drawer on the left, toggled by Ctrl+B / NavBar icon; search box, kind + color filter chips, group toggle; item click → `goTo(page)` then `pulse(id)`; header buttons "Export Markdown" and "Copy all" (clipboard via `navigator.clipboard.writeText(await api.export.markdownText(bookId))`, toast "Copied").

- [ ] **Step 1: Failing unit tests:** filter by query matches note text; colors filter excludes others; groupBy color order fixed; groupBy page ascending.
- [ ] **Step 2: Failing e2e:** create 2 highlights (page 3 yellow, page 9 blue) via API, Ctrl+B → 2 items; filter blue → 1; click it → page box shows 9; Export Markdown (stub dialog via `PAGETURN_SAVE_PATH` env honored by main) → file contains `## Page 9`.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: notebook panel with filters, jump and export`.

### Task 3: Backups (auto daily + manual export/import)

**Files:**
- Create: `src/main/export/backup.ts`, `src/renderer/settings/DataSettings.tsx`; Modify: `src/main/index.ts`, `ipc/export.ts`, preload
- Test: `tests/unit/main/backup.test.ts`, `tests/e2e/backup.spec.ts`

**Interfaces:**
- Produces:
```ts
const BACKUP_VERSION = 1;
type Backup = { version: 1; createdAt: number; books: BookRow[]; highlights: Highlight[]; notes: Note[]; ink: (Omit<InkStroke,'points'> & { points: number[] })[]; bookmarks: Bookmark[]; settings: Settings };
function createBackup(db): Backup;   // no API keys ever
function parseBackup(json: string): Backup;   // zod; version !== 1 → throws BackupVersionError('This backup was made by a newer version of PageTurn.')
function mergeBackup(db, b: Backup): { added: number; updated: number; skipped: number };   // single transaction; by id; replace only if incoming updatedAt (or createdAt) is newer
function rotateBackups(dir: string, keep = 7): void;   // deletes oldest `pageturn-YYYY-MM-DD.json` beyond keep
function scheduleDailyBackup(db, dir: string, now = Date.now): () => void;   // on startup: if no file for today, write one; then every 24h; returns cancel
// Api: export.backup(): Promise<{saved:boolean;path?}>, export.importBackup(): Promise<{added;updated;skipped} | {error:string}>, export.openDataFolder(): Promise<void>
```
  DataSettings: "Open data folder", "Export backup (JSON)", "Import backup" (shows result counts or error).

- [ ] **Step 1: Failing tests:** `createBackup` JSON has no key named `apiKey` and no string starting `sk-`; round-trip into an empty DB recreates all rows; merge where existing note `updatedAt` newer → kept (skipped++), older → replaced (updated++) (Review Focus 3); `version: 2` → `BackupVersionError` and DB unchanged; `rotateBackups` with 9 dated files leaves newest 7; `scheduleDailyBackup` doesn't write twice on the same day.
- [ ] **Step 2: Failing e2e:** export backup to `PAGETURN_SAVE_PATH`, delete a highlight, import → highlight back.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: automatic and manual JSON backups`.

### Task 4: Save-retry, logging, toasts, crash handling

**Files:**
- Create: `src/main/db/retry.ts`, `src/main/logging.ts`, `src/renderer/app/Toasts.tsx`; Modify: Plan 2 annotation IPC handlers (wrap writes), `src/main/index.ts`, `App.tsx`
- Test: `tests/unit/main/retry.test.ts`

**Interfaces:**
- Produces:
```ts
function withRetry<T>(fn: () => T, opts?: { attempts?: 3; baseMs?: 200; onRetry?: (n: number) => void }): Promise<T>;   // delays 200, 400, 800
// renderer: toast(msg: string, opts?: { kind?: 'info'|'error'; action?: { label: string; run: () => void } }): void
// annotationStore: pendingWrites: number; on failure after retries keep item in memory list `unsaved`
// main: before-quit → ask renderer `app:hasUnsaved`; if true show dialog "Some changes couldn't be saved. Quit anyway?" (Quit / Cancel)
```
  `logging.ts`: electron-log to `userData/logs/main.log` (5 MB rotate); `process.on('uncaughtException')`, renderer `window.onerror`/`unhandledrejection` forwarded via IPC → log + toast "Something went wrong"; `render-process-gone` → dialog "PageTurn hit a problem. Restart?" → `app.relaunch(); app.exit()`.

- [ ] **Step 1: Failing tests:** fn failing twice then succeeding → resolves, `onRetry` called with 1, 2; always failing → rejects after 3 attempts; delays (fake timers) 200/400.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: write retries, logging, toasts and crash recovery`.

### Task 5: Polish — paper tints, sound, shortcuts, focus mode, accessibility

**Files:**
- Create: `src/renderer/app/shortcuts.ts`, `src/renderer/reader/sound.ts`, `assets/page-turn.mp3` (CC0 sound; record source + license in `assets/CREDITS.md`), `src/renderer/settings/PenSettings.tsx`; Modify: `BookStage`/`CurlRenderer` (tint), `ReaderView.tsx`, `SettingsView.tsx`
- Test: `tests/unit/renderer/shortcuts.test.ts`

**Interfaces:**
- Produces:
```ts
type ShortcutMap = Record<string, () => void>;   // keys like 'ArrowRight', 'Ctrl+G', 'p', 'F11'
function normalizeKey(e: KeyboardEvent): string;   // 'Ctrl+Shift+X' ordering Ctrl, Alt, Shift; letters lower-case
function isTypingTarget(t: EventTarget | null): boolean;   // input, textarea, select, contenteditable
function installShortcuts(map: ShortcutMap): () => void;   // single-letter and Space ignored when isTypingTarget (Review Focus 4); Ctrl/F-keys/Esc always active
function playTurnSound(): void;   // only if settings.turnSound && style !== 'instant' && !reducedMotion; volume 0.4
```
  Consolidate all reader shortcuts from Plans 1–3 into one `installShortcuts` call in `ReaderView`. Focus mode (F11): fullscreen + hide NavBar until mouse at top 40 px. PenSettings: "Draw with mouse", default pen color/width (Plan 2 settings keys). Paper tint applied via `CurlRenderer.setTint` and `SlideStage` CSS. Accessibility: every icon button has `aria-label`; panels are `role="dialog"`/`complementary` with focus trap on modals; visible focus ring; contrast ≥ 4.5:1 for UI text in both themes; page-turn buttons reachable by Tab.

- [ ] **Step 1: Failing tests:** `normalizeKey` (Ctrl+Shift+g) → `'Ctrl+Shift+g'`; 'p' keydown on a textarea target does not call handler, 'Ctrl+b' on textarea does; Esc always fires.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS. Run Playwright + `@axe-core/playwright` on library and reader: zero serious/critical violations (add as `tests/e2e/a11y.spec.ts`).
- [ ] **Step 5:** Commit `feat: polish — tints, sound, unified shortcuts, focus mode, a11y`.

### Task 6: First-run onboarding with sample PDF

**Files:**
- Create: `src/renderer/app/Onboarding.tsx`, `resources/sample/Welcome-to-PageTurn.pdf` (generated by extending `scripts/make-fixtures.ts`: 6 pages explaining turning, highlighting, pen, Help, Notebook); Modify: `src/main/index.ts` (on first run import sample from `process.resourcesPath`), Settings (`onboardingDone: boolean = false`)
- Test: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Produces: 4-step overlay tour (Library → open book → "Drag a corner to turn" → "Select text, press Ctrl+E for help"), Skip/Next/Done; sets `onboardingDone`. Settings → About: "Show tour again".

- [ ] **Step 1: Failing e2e:** fresh userData → library contains "Welcome to PageTurn" and tour visible; click through Done → restart → no tour, sample not re-imported.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: first-run tour with sample book`.

### Task 7: Packaging, file association, single instance, fuses, auto-update

**Files:**
- Create: `electron-builder.yml`, `build/icon.ico` (256×256 multi-size), `scripts/fuses.cjs`, `src/main/updater.ts`, `src/renderer/settings/AboutSettings.tsx`, `.github/workflows/release.yml`; Modify: `src/main/index.ts`, `package.json` (`"dist": "electron-vite build && electron-builder --win"`)
- Test: `tests/e2e/singleInstance.spec.ts`

**Interfaces:**
- `electron-builder.yml`: `appId: com.pageturn.app`, `productName: PageTurn`, `win.target: nsis (x64)`, `nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true }`, `fileAssociations: [{ ext: pdf, name: PDF Document, role: Viewer }]`, `extraResources: resources/sample`, `asarUnpack: '**/*.node'`, `publish: { provider: github }`, `afterPack: scripts/fuses.cjs`.
- `fuses.cjs` flips exactly the fuses listed in Global Constraints.
- `updater.ts`: `initUpdater(win)` → `autoUpdater.checkForUpdatesAndNotify()` on startup (skip when `!app.isPackaged`), events forwarded as `update:available | update:downloaded`; Api `app.checkForUpdates()`, `app.installUpdate()`, `app.version()`. About shows version, "Check for updates", "Restart to update" when downloaded, link to logs folder.
- Single instance: `app.requestSingleInstanceLock()`; second instance argv `.pdf` → focus + import + `library:openRequest` (Review Focus 5).
- CI workflow: on tag `v*`, windows-latest, `npm ci && npm test && npm run dist` with `GH_TOKEN`; signing only if `CSC_LINK` secret exists.

- [ ] **Step 1: Failing e2e:** launch app, then spawn a second electron process with `tests/fixtures/odd-3.pdf` argv → second process exits within 3 s, first window navigates to reader for that book.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Run `npm run dist` → `dist/PageTurn-Setup-<version>.exe` exists. Verify fuses: `npx @electron/fuses read --app dist/win-unpacked/PageTurn.exe` shows RunAsNode Disabled. Human: install the exe on Windows, right-click a PDF → Open with → PageTurn opens it; uninstall cleanly.
- [ ] **Step 6:** Commit `build: NSIS installer, file association, fuses, auto-update`.

### Task 8: Release verification

- [ ] **Step 1:** Run `npm test && npm run test:e2e && npm run lint` → all green.
- [ ] **Step 2:** Run the perf spec from Plan 1 against the packaged app (`PAGETURN_APP_PATH=dist/win-unpacked/PageTurn.exe`) → p95 ≤ 20 ms.
- [ ] **Step 3:** Walk spec §1 success criteria 1–6 manually; record pass/fail in `docs/RELEASE-CHECKLIST.md`.
- [ ] **Step 4:** Commit `docs: v1 release checklist` and tag `v1.0.0` (push only when the human says so).

---

## Done criteria for Plan 4
Notebook lists/filters/jumps and exports Markdown; daily + manual backups with safe merge; failed saves retry and warn; unified shortcuts, tints, sound, focus mode, a11y; first-run tour; signed-ready NSIS installer with PDF "Open with", single-instance handoff, hardened fuses and auto-update. All tests pass and the release checklist is complete.
