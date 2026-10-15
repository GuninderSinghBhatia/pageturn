# PageTurn Plan 1 — Progress

Plan: `docs/superpowers/plans/2026-10-16-pageturn-plan1-core-reader.md`
Spec: `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md`

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Skeleton | done | 8382397 | see notes below |
| 2 Shared types/IPC | done | f04f039 | `Channels.libraryOpenRequest` is the main→renderer event; extra schemas `BookMetaSchema`, `PngSchema`. `pathForFile` gets added to `Api` in Task 6 |
| 3 SQLite/repos | done | a186244 | `import.meta.glob` uses `{ query: '?raw', import: 'default' }` (Vite 8 form of `as: 'raw'`). WAL on. `upsert` COALESCEs title/author/numPages so re-import keeps metadata |
| 4 Library import/IPC | done | f92109a | `registerIpc` in `src/main/ipc/index.ts`; payload helper `parse()` in `ipc/validate.ts`; `importAsBooks(repo, paths)` exported from `ipc/library.ts`. `toBook(row, fsExists: (p)=>boolean, thumbDir)`. Preload built with `externalizeDeps: false` (sandbox can only require electron). Single-instance lock + argv/second-instance → `library:openRequest`. Relocate mismatch shows a warning dialog and returns null |
| 5 pdf.js + cache | done | 5db4067 | workerSrc via `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` (Vite can't resolve bare specifiers in `new URL()`). pdfjs 6: destroy via loading task (`PDFDocumentProxy.destroy` gone). `pageSize(n)` returns page 1's size until page n is loaded. Tests mock `pdfjs-dist` → legacy build. **TODO Task 7:** pass `standardFontDataUrl` (copy `node_modules/pdfjs-dist/standard_fonts` into renderer public) — fixtures use non-embedded Times; also verify worker loads under CSP from file:// |
| 6 Library view | todo | | |
| 7 Reader shell | todo | | user checkpoint: tell them how to run the app |
| 8 Prefetch | todo | | |
| 9 Curl math | todo | | |
| 10 WebGL stage | todo | | user checkpoint: approve curl look before saving baseline |
| 11 Settings/theme | todo | | then run full test/e2e/lint and give launch command |

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
