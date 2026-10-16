# PageTurn Plan 1 — Progress

**Plan 2 complete (2026-10-16, branch `plan2-annotations`):** highlights, notes, bookmarks, ink with eraser/undo, annotations baked into the curl. Plan: `docs/superpowers/plans/2026-10-16-pageturn-plan2-annotations-ink.md`. 143 unit + 24 e2e green. Notes: settings overlay/ink/annotation UI state live in small zustand stores (`annotations/uiStore.ts`, `ink/inkStore.ts`); e2e helpers in `tests/e2e/annotationHelpers.ts` (import helpers from there, never from a spec); text layers expose `data-rendered`. Chromium sends synthetic button-less pointermoves — every drag handler must ignore `buttons === 0`.

**Plan 1 complete (2026-10-16):** 73 unit + 10 e2e tests, lint, typecheck and build all green. Next: Plan 2 (Annotations + Ink).

Plan: `docs/superpowers/plans/2026-10-16-pageturn-plan1-core-reader.md`
Spec: `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md`

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Skeleton | done | 8382397 | see notes below |
| 2 Shared types/IPC | done | f04f039 | `Channels.libraryOpenRequest` is the main→renderer event; extra schemas `BookMetaSchema`, `PngSchema`. `pathForFile` gets added to `Api` in Task 6 |
| 3 SQLite/repos | done | a186244 | `import.meta.glob` uses `{ query: '?raw', import: 'default' }` (Vite 8 form of `as: 'raw'`). WAL on. `upsert` COALESCEs title/author/numPages so re-import keeps metadata |
| 4 Library import/IPC | done | f92109a | `registerIpc` in `src/main/ipc/index.ts`; payload helper `parse()` in `ipc/validate.ts`; `importAsBooks(repo, paths)` exported from `ipc/library.ts`. `toBook(row, fsExists: (p)=>boolean, thumbDir)`. Preload built with `externalizeDeps: false` (sandbox can only require electron). Single-instance lock + argv/second-instance → `library:openRequest`. Relocate mismatch shows a warning dialog and returns null |
| 5 pdf.js + cache | done | 5db4067 | workerSrc via `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` (Vite can't resolve bare specifiers in `new URL()`). pdfjs 6: destroy via loading task (`PDFDocumentProxy.destroy` gone). `pageSize(n)` returns page 1's size until page n is loaded. Tests mock `pdfjs-dist` → legacy build. Standard fonts + CSP worker resolved in Task 6 (postinstall copies fonts to `src/renderer/public/standard_fonts`, gitignored; worker loads with no fallback warning) |
| 6 Library view | done | 911dc94 | **Api additions:** `library.onChanged(cb)` (main emits `library:changed` after import/remove/relocate) and `library.pathForFile(file)`. Nav store `useNav` in `app/nav.ts`. `displayTitle` in `library/displayTitle.ts`. Base CSS tokens in `app/base.css` (Task 11 adds theme.css). Thumbnails skip password PDFs (no prompt in library). Reader view is a placeholder in App.tsx |
| 7 Reader shell | done | da6b961 | Store `page` = spread start; **page box shows highest visible page** (plan e2e: 3 presses → 7). Store additions: `layoutMode`, `setLayout`, `setLayoutMode`, `status`, `error`, `passwordRequest`, `submitPassword`. Extra files: `BookStage/PageCanvas.tsx`, `PasswordPrompt.tsx`, `useReaderKeys.ts`, `useViewport.ts` (size + drag-pan), `Reader.module.css`. Stage exposes `data-testid=book-stage`, `data-ready`, `data-pages`. Default app menu removed (its Ctrl+± accelerators). Find: results tagged by needle to avoid Enter-before-search race. Dev mode verified: no CSP errors. User was given run instructions |
| 8 Prefetch | done | 54dadb2 | `PageCanvas` takes a `scale` prop; `SlideStage` takes `scaleFor(page)`. ReaderView: `renderZoom` (150 ms debounce) + `scaleAt(p, zoom)`; Prefetcher prefetches at min(zoom,1) so neighbour keys match fit-size renders. Measured: turns painted in 6–10 ms after prefetch |
| 9 Curl math | done | 3a0c4e1 | y-down page-local coords; right corners mirror to x=-1, left to x=2. `shouldComplete(progress, vx, dir)`: dir = screen-x direction of completion (-1 for forward turns). Extra exports: `cornerPos`, `mirroredCorner` |
| 10 WebGL stage | done | 4d54add | Curl look approved by user; baseline `tests/e2e/curl.spec.ts-snapshots/curl-mid-win32.png`. Turns route through `readerStore.requestTurn(dir)` → stage's `turnHandler` (falls back to next/prev). Fragment shader needs `precision highp int` (u_mode shared with VS). `PAGETURN_DISABLE_WEBGL=1` → `webPreferences.webgl: false` (`--disable-webgl` switch doesn't stop WebGL2). Gesture ignores `pointermove` with `buttons===0` (Chromium/Playwright screenshots emit synthetic moves). Stage exposes `data-stage` (curl/slide), `data-settled`, `data-right-rect`. Perf: p95 7.1 ms |
| 11 Settings/theme | done | 1ab0c08 | Settings is an **overlay** (`useNav().settingsOpen` / `openSettings` / `closeSettings`), not a view, so the open book stays loaded and changes apply live; Esc closes; reader keys ignored while open. Gear button in NavBar and library toolbar. Tokens moved from `base.css` to `app/theme.css` (`data-theme` light/dark). `applyTheme`/`useThemeSync` in `app/theme.ts`; settingsStore applies theme on load/set. Night tint remapped to warm charcoal/off-white in shader. Extra e2e `settings.spec.ts`. Tint only affects the WebGL stage (slide fallback shows untinted pages) |

## Notes for next sessions
- Env: Node 22.23, npm 10.9, Git 2.49, VS Build Tools 2019 (C++). No qpdf; no `python` on PATH (use `py`).
- Versions installed: Electron 44, electron-vite 6, Vite 8, React **18** (pinned per spec; template had 19), zod 4, zustand 5, pdfjs-dist 6, better-sqlite3 13, Vitest 5, Playwright.
- Renderer root is `src/renderer` (template's `src/renderer/src` removed). Entry `src/renderer/main.tsx`. Aliases `@shared`, `@renderer`.
- **VS Code terminals set `ELECTRON_RUN_AS_NODE=1`**: `tests/e2e/helpers.ts` strips it. For `npm run dev` from a VS Code terminal you may need to unset it first.
- Dev-only CSP relaxation (inline script/style for Vite HMR) via plugin in `electron.vite.config.ts`; production `index.html` has the exact CSP.
- ESLint 9 flat config (`eslint.config.mjs`) used instead of `.eslintrc.cjs`; Prettier config is `.prettierrc.yaml`.
- `password.pdf` generated with **pdfkit** (pdf-lib can't encrypt; qpdf not installed). Fixtures committed.
- `npm run test:e2e` = `electron-vite build && playwright test` (skips typecheck; `npm run build` includes typecheck).
- better-sqlite3 13 ships N-API prebuilds: the same binary loads under Vitest (Node) and Electron, so no `test:main` script is needed.
- Dev CSP not yet verified by hand in `npm run dev` (check it at Task 7).
- In bash heredocs, `\\` collapses: write TS strings with backslashes via the Write/Edit tools.
- Preload typings live in `src/preload/api.d.ts` (an `index.d.ts` next to `index.ts` is ignored by TS).
