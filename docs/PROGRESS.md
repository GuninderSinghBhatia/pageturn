# PageTurn Plan 1 — Progress

Plan: `docs/superpowers/plans/2026-10-16-pageturn-plan1-core-reader.md`
Spec: `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md`

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 Skeleton | done | 8382397 | see notes below |
| 2 Shared types/IPC | done | f04f039 | `Channels.libraryOpenRequest` is the main→renderer event; extra schemas `BookMetaSchema`, `PngSchema`. `pathForFile` gets added to `Api` in Task 6 |
| 3 SQLite/repos | todo | | |
| 4 Library import/IPC | todo | | |
| 5 pdf.js + cache | todo | | |
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
- better-sqlite3 `postinstall` (`electron-builder install-app-deps`) builds for Electron ABI: expect the Vitest ABI issue in Task 3 (plan has the `test:main` workaround).
- Dev CSP not yet verified by hand in `npm run dev` (check it at Task 7).
- In bash heredocs, `\\` collapses: write TS strings with backslashes via the Write/Edit tools.
