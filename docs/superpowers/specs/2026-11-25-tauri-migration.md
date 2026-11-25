# Spec: move PageTurn from Electron to Tauri (Rust)

Branch: `tauri-migration`. Date: 2026-11-25.

## Why

Measured on the current build (`dist/`):

|                                               | Size   |
| --------------------------------------------- | ------ |
| Installer                                     | 95 MB  |
| Installed app                                 | 308 MB |
| of which Electron's Chromium (`PageTurn.exe`) | 235 MB |
| of which our own code (`app.asar`)            | 13 MB  |

Almost all the weight is the browser Electron ships. Tauri uses WebView2, which is already part
of Windows 10/11, and a small Rust binary instead of Node. Expected result: an installer around
10 MB, lower RAM, faster start. Page rendering speed should stay about the same: it is already
GPU-bound (WebGL curl, p95 7.1 ms per frame) and the same web code keeps doing it.

## What changes and what stays

| Part                                       | Today                                   | After                                                                                               |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UI (`src/renderer`)                        | React in Chromium                       | **same React code** in WebView2                                                                     |
| PDF rendering, WebGL curl                  | pdf.js, WebGL2                          | **same**                                                                                            |
| Bridge (`src/preload`)                     | Electron preload exposing `window.api`  | `src/renderer/platform/tauriApi.ts` building **the same `window.api`** on Tauri `invoke` / `listen` |
| Main process (`src/main`, ~2,300 lines TS) | Node + Electron                         | Rust in `src-tauri/`                                                                                |
| Database                                   | better-sqlite3                          | `rusqlite`, **same SQL migration files** (`include_str!`)                                           |
| Data folder                                | `%APPDATA%\PageTurn`                    | **same folder** (not Tauri's default), so existing libraries carry over                             |
| API keys                                   | Electron safeStorage                    | Windows DPAPI (keys stay encrypted, main side only)                                                 |
| AI providers, Wikipedia, rag-service calls | Node `fetch`                            | `reqwest` (streaming for AI)                                                                        |
| Single instance, "Open with"               | Electron lock + argv                    | `tauri-plugin-single-instance`                                                                      |
| Updater, installer                         | electron-updater, electron-builder NSIS | `tauri-plugin-updater` (signed), Tauri NSIS bundle                                                  |
| rag-service                                | Python                                  | **unchanged** (still HTTP on localhost:8000)                                                        |

Rule kept from today: the UI never touches files, the database or the network; every call goes
through `window.api`, and the main side validates input.

## The seam

`src/shared/ipc.ts` already defines the full `Api` type (~65 methods). The migration keeps that
type and gives it a second implementation:

- Electron build: `src/preload/index.ts` (unchanged until Electron is removed).
- Tauri build: `src/renderer/platform/tauriApi.ts`, installed as `window.api` before React
  starts when running inside Tauri.

Each `Channels.x` becomes a Rust command named after it (`library:list` → `library_list`).
Main → UI events (`library:changed`, `ai:token`, …) become Tauri events with the same names.

Known places where the API cannot be copied one-to-one:

1. `library.pathForFile(file)`: WebView2 does not expose paths of dropped files. Tauri's
   window drag-drop event gives paths instead; `BooksTab` listens to it in the Tauri build.
2. `library.getFile`: returns PDF bytes; use Tauri's raw binary response (no JSON).
3. `web.*`: Electron embeds a second web view in the window. Tauri's multi-webview is still
   behind an "unstable" flag; first version opens the page in its own window, revisit later.
4. `window.platform`: comes from Tauri's OS plugin or is fixed to `win32` at build time.

## Stages

Electron keeps working on this branch until the last stage, so every stage can be tested
against the existing suites.

| Stage                                | Scope                                                                                                                                                                                         | Done when                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **S0 Skeleton**                      | `src-tauri/` project, Vite build of the same renderer, `tauriApi.ts` shim, data folder resolution                                                                                             | `npm run tauri:dev` opens the PageTurn home screen in a Tauri window |
| **S1 Library + reading**             | DB + migrations, books repo, library commands (list, import, dialog, remove, relocate, get file, thumbnail, meta, like), settings, reader progress, window controls, drag-drop                | open a book from the shelf and read it; existing library shows up    |
| **S2 Annotations + export**          | annotations repo and commands, Markdown export, backup / restore, daily backup, first-run Welcome book, logging, single instance + "Open with"                                                | highlights, notes, ink and bookmarks survive restart                 |
| **S3 Network features**              | Wikipedia look-up, rag-service (`rag:*`), AI providers with streaming, DPAPI key storage                                                                                                      | Look up, Ask the book and Explain work                               |
| **S4 Web tab + updater + installer** | web view (window first), signed updater, NSIS bundle, release script                                                                                                                          | installer built; size measured against the 95 MB baseline            |
| **S5 Tests and Electron removal**    | Rust unit tests for repos / import / backup; renderer unit tests unchanged; e2e moved from Playwright-Electron to WebDriver (`tauri-driver`); delete `src/main`, `src/preload`, Electron deps | all suites green on Tauri only                                       |

## Risks

- **e2e tests**: Playwright cannot drive a Tauri window. Porting 44 e2e tests to WebDriver is the
  biggest single job (S5).
- **WebGL in WebView2**: same Chromium engine family, but GPU flags differ; the curl must be
  checked by eye and with the existing snapshot (`curl.spec.ts-snapshots`).
- **Updates for existing users**: the Electron updater cannot install a Tauri app. Last Electron
  release needs a one-time "download the new version" notice, or a manual reinstall.
- **Data folder**: Tauri must open `%APPDATA%\PageTurn`, not `%APPDATA%\com.pageturn.app`.
- **Code signing**: Tauri's updater requires its own signing key (separate from Windows code
  signing, which the app does not have yet).

## Out of scope

- Rewriting the UI in a Rust toolkit (chosen against: months of work, small extra gain).
- Changing rag-service.
- macOS / Linux builds (kept possible, not tested).

## Status and measured results (2026-11-25)

All stages S0 to S4 are done and S5 is largely done. Electron is still in the repository and still
works (44 of 44 end-to-end specs pass), so the two builds can ship side by side.

| Measured                                           | Electron   | Tauri      |
| -------------------------------------------------- | ---------- | ---------- |
| Installer                                          | 95.1 MB    | **4.8 MB** |
| Program file                                       | 234 MB     | **8.6 MB** |
| Page-turn frame time, p95 (1000-page book)         | 7.1 ms     | 7.1 ms     |
| Start-up to home screen (median of 3)              | **728 ms** | 1062 ms    |
| Open a 500-page book (median of 3)                 | **623 ms** | 948 ms     |
| RAM at home, private bytes (app + child processes) | 286 MB     | **226 MB** |
| RAM at home, working set                           | 408 MB     | 390 MB     |
| RAM with a book open, working set                  | 481 MB     | 468 MB     |

How to read this honestly:

- The win is **size** (about 20 times smaller to download, 27 times smaller on disk). Private memory
  is about 20 % lower; total working set is nearly the same, because WebView2 is also a full browser
  engine, just one that Windows already ships.
- **Speed is not better; start-up is about 330 ms slower** and opening a book about 300 ms slower in
  this measurement. Page turns are identical, as expected (the same WebGL code on the same GPU).
- The numbers come from 3 interleaved runs each through the same remote-debugging harness
  (`tests/measure/startup.spec.ts`, `npm run` is not wired; run
  `npx playwright test -c playwright.measure.config.ts`). The first Tauri run was a cold-start outlier
  (1746 ms). They are indicative, not a benchmark.
- Not yet investigated: where the extra Tauri start-up time goes (WebView2 creation, first-run work,
  or the page's own start-up). Worth profiling if start-up matters.

Remaining: the web tab is a separate window (not embedded) and untested in a real session; dropping a
PDF onto the shelf is untested; the first real release and the one-time reinstall notice for Electron
users.
