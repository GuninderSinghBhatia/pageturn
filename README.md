# PageTurn

**A Windows PDF reader that feels like a real book.** Open a PDF and you get only the book: a two-page spread on a calm background, a realistic WebGL page flip when you turn, and tools that stay hidden until you reach for them.

**It is also a RAG application.** *Ask the book* answers questions from your PDF using **both vector RAG and graph RAG**, cites every page, and won't spoil pages you haven't read yet. On a hand-checked golden set it finds the right page in the top 3 passages **80%** of the time, and **87%** on relationship questions when vector and graph retrieval work together ([numbers below](#ask-the-book-vector-rag--graph-rag)).

![A page flipping over mid-turn](tests/e2e/curl.spec.ts-snapshots-tauri/flip-mid-win32.png)

## Download

**[⬇ Download PageTurn for Windows](https://github.com/GuninderSinghBhatia/pageturn/releases/latest/download/PageTurn-Setup.exe)** — Windows 10/11, 64-bit, about 5 MB. Always the newest version.

Run it and choose where to install. The installer is not code-signed yet, so Windows may show "Windows protected your PC": click **More info → Run anyway**. Afterwards, right-click any PDF and choose **Open with → PageTurn**.

PageTurn updates itself: when a new version is out, it downloads in the background and a message offers **Restart now**.

To publish an update (maintainers): see [docs/UPDATER.md](docs/UPDATER.md).

---

## Features

### Reading

- **Two-page spreads** with page 1 as a cover on the right; single page in narrow windows (under 1000 px) or by choice.
- **WebGL page flip.** Press an arrow key, click or scroll and the whole page lifts at its edge and swings over the spine like a real leaf, with perspective, a slight paper bend, lighting and shadows on the pages beneath. Drag the page edge and it follows your hand. Falls back to a slide transition without WebGL.
- **Nothing but the book.** No toolbars, no sidebars. In a normal window the window itself takes the book's shape, so there is no empty space around the pages.
- **Themes:** Light (`#FAF8F4` paper), Sepia, and Dark. Dark inverts page brightness in the shader and keeps colours.
- Zoom 50–400% inside the book view (drag or scroll to pan), go to page, table of contents, whole-book search, and your last page remembered per book.
- Password-protected PDFs are supported; scanned PDFs open with a notice that their text can't be selected.

### Hidden toolbar

Move the pointer to the top edge, or press **T**, and a dark pill slides in:

Back · Highlighter · Underline (straight / wavy) · Pen · Eraser · Bookmark · Contents · Search · page `12 / 500` · Aa (theme, zoom, layout, settings) · Fullscreen

It hides again 800 ms after the pointer leaves. It stays pinned while a tool is active, until **Esc**. After 2 s without movement the cursor hides too.

### Annotations

- **Highlights** in four colours, underlines (straight or wavy), with selections spanning both pages split per page.
- **Right-click a selection** for: Make a note · Ask AI · Look up · Highlight · Copy.
- **Look up** a selection on Wikipedia: a summary card with the article image appears beside the page. In Settings you can switch to Wiktionary, Merriam-Webster, Britannica, Google, DuckDuckGo or any site (`https://…{query}`), pick the Wikipedia language, and open full pages in a small in-app window or your browser.
- **Notes** on text show a dotted underline and a margin dot. Free sticky notes can go anywhere ("Add note here"). Notes autosave.
- **Pen and marker ink** with real stylus pressure (via `perfect-freehand`), 6 colours, 3 widths, an eraser, and undo/redo.
- **Bookmark tabs:** pastel, numbered ribbons sticking out of the right page edge. Click to jump; right-click to rename or delete.
- Annotations are **baked into the page texture**, so they curl with the paper.
- Everything is saved locally and survives restarts and moving the PDF: books are identified by a content hash, not a path.

### Ask the book (RAG)

- **Ask the book:** ask a question and get an answer built only from passages found in your PDF, with clickable page citations.
- **Who is this?:** select a name or term and get a summary of every mention so far, plus related terms from the knowledge graph ("Connected in the book").
- **Spoiler Shield:** passages past the page you are on are never used.
- Runs in a separate local Python service (`rag-service/`, FastAPI). It is a preview and ships separately for now.

### Help, notebook and your data

- **Help panel (Ctrl+E):** select a passage and get a streamed explanation from your own Anthropic, OpenAI or Gemini key (stored encrypted on your computer), with follow-ups, quick actions and Save as note. The **Web** tab searches the passage in-app.
- **Notebook (Ctrl+B):** every highlight, note, bookmark and handwritten page in a book, searchable and filterable, with Markdown export.
- **Backups:** a JSON backup every day (last 7 kept), plus manual export and import in Settings. Backups never include API keys.
- First-run tour with a Welcome book, an optional page-turn sound, auto-update, and logs in your user data folder. No usage data is collected.

### Keyboard

| Key                                                 | Action                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| `→` `Space` `PageDown` / `←` `Shift+Space` `PageUp` | Next / previous spread                                   |
| `T`                                                 | Show / hide the toolbar                                  |
| `H` · `N` · `A`                                     | Highlight · note · Ask AI on the selection               |
| `B` or `Ctrl+D`                                     | Bookmark the page                                        |
| `P` · `E`                                           | Pen · eraser                                             |
| `Ctrl+Z` / `Ctrl+Y`                                 | Undo / redo ink                                          |
| `Ctrl+F` · `Ctrl+G`                                 | Search · go to page                                      |
| `Ctrl` `+` / `-` / `0`                              | Zoom                                                     |
| `F11`                                               | Fullscreen                                               |
| `Esc`                                               | Close card → leave tool → hide toolbar → exit fullscreen |

---

## Getting started

Requirements: **Windows 10/11** (WebView2 is built in), **Node.js 22+**, npm 10+, and **Rust** (stable, via [rustup](https://rustup.rs)) with the Visual Studio Build Tools (C++ workload).

```bash
git clone https://github.com/GuninderSinghBhatia/pageturn.git
cd pageturn
npm install
npm run dev
```

Then drag a PDF onto the window, or click **Open PDF**.

### Scripts

| Script                            | What it does                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                     | Run the app (Tauri) with hot reload for the UI                                                         |
| `npm run build`                   | Typecheck, then build the release app and its NSIS installer (`src-tauri/target/release/bundle/nsis/`) |
| `npm test`                        | Unit and component tests (Vitest)                                                                      |
| `npm run test:rust`               | Rust unit tests (`cargo test` in `src-tauri/`)                                                         |
| `npm run test:e2e`                | Build the debug app, then end-to-end tests against it (Playwright attached over CDP)                   |
| `npm run tauri:test`              | Tests of the Rust commands through the real app (`tests/tauri/`)                                       |
| `npm run release`                 | Build the signed installer and update feed in `dist-tauri/` (uploads nothing)                          |
| `npm run lint` · `npm run format` | ESLint · Prettier                                                                                      |
| `npm run fixtures`                | Regenerate the test PDFs in `tests/fixtures/`                                                          |

---

## How it works

```
Rust backend (src-tauri)                   Renderer (React, in WebView2)
────────────────────────                   ─────────────────────────────
SQLite (rusqlite)                          ReaderView
  books · highlights · notes               ├─ BookStage (WebGL curl) / SlideStage
  ink_strokes · bookmarks · settings       ├─ PageOverlay per page: pdf.js text layer,
library import, hashing, thumbnails        │   annotation canvas, notes, bookmark tabs
window shape (aspect lock)                 ├─ ReaderToolbar (hidden pill)
          ▲                                ├─ SelectionMenu, cards, ink input
          │  Tauri commands, validated     pdf.js in a Web Worker + LRU page cache
          └──────────── window.api ───────▶ Zustand stores
```

- **Security:** the renderer has no file, database or network access. It reaches the computer only through a typed `window.api` (`src/renderer/platform/tauriApi.ts`), whose calls are Rust commands that validate every argument. API keys are encrypted with Windows DPAPI. Strict CSP, and no global Tauri object in the page.
- **Page flip:** a 40×60 mesh rotated around the spine in the vertex shader; the paper bends along a length-preserving arc with perspective (`webgl/flipMath.ts`, unit-tested and mirrored in GLSL). Frame times hold at about 7 ms p95 on a 1000-page PDF; the perf test fails above 20 ms.
- **Annotations:** coordinates are normalized 0..1 of the page, so they survive zoom and layout changes. Saves are optimistic, with 3 retries and a rollback plus toast on failure. Ink points are stored as packed `Float32Array` blobs.
- **Data** lives in `%APPDATA%/PageTurn/` (`pageturn.db`, `thumbnails/`). Removing a book can keep its annotations, which come back if the same file is re-imported.

### Ask the book: vector RAG + graph RAG

```
PDF ─▶ chunks (500 chars, 100 overlap, page kept) ─┬─▶ embeddings (all-MiniLM-L6-v2) ─▶ Chroma      (vector RAG)
                                                  └─▶ LLM extracts terms + relations ─▶ Neo4j       (graph RAG)
question ─▶ vector search  ┐
         ─▶ graph lookup   ┴─▶ top passages (none past your page) ─▶ gpt-oss-120b on Groq ─▶ answer with page citations
```

1. **Vector RAG** finds passages whose meaning is closest to the question.
2. **Graph RAG**: an LLM read each passage and pulled out terms and how they relate, stored as a knowledge graph in Neo4j. Questions about connections ("what is X a variant of?") follow the links.
3. Only the retrieved passages go to the model, which answers from them and cites pages. The retriever is chosen with `RAG_RETRIEVER=vector|tree|hybrid|graph|vector+graph`.

**Results on the golden set** (hit@3 = the right page is in the top 3 passages; page numbers in every question were checked against the PDF):

| Question set | Vector | Graph only | Vector + graph |
| --- | --- | --- | --- |
| 25 whole-book questions | **80%** | 8% | 76% |
| 15 relationship questions (graph chapter) | 80% | 53% | **87%** |
| Avg retrieval time | 0.03 s | 0.10 s | 0.15–0.21 s |

- Right page within one page: 84%. Off-topic questions refused: 4 of 4.
- Also tried a table-of-contents tree retriever (80%, but ~2,450 LLM tokens per question) and a tree + vector hybrid (68%); plain vector won on cost.
- Test book: a 991-page technical book (2,990 chunks). The graph so far covers one 100-page chapter (314 chunks → 1,019 terms, 1,136 links), so `vector+graph` only consults it inside that chapter.
- Caveat: the sets are small, so one question moves a score by 4–7 points.

Details: [rag-service/README.md](rag-service/README.md) · [rag-service/GRAPH_RAG.md](rag-service/GRAPH_RAG.md) · raw results in `rag-service/evals/results.csv` and `rag-service/graph/evals/results.csv`.

### Tech stack

Tauri 2 (Rust, WebView2) · rusqlite · reqwest · TypeScript (strict) · React 18 · Vite · Zustand · CSS Modules · pdfjs-dist · WebGL2 · zod · perfect-freehand · Vitest · Testing Library · Playwright · ESLint · Prettier

RAG service: Python · FastAPI · LangChain · Chroma · sentence-transformers · Neo4j · Groq (gpt-oss-120b / gpt-oss-20b) · pytest

### Project layout

```
src-tauri/       Rust backend: commands (library, annotations, settings, AI, look-up, rag,
                 web, export, window, app), SQLite + migrations, updater, installer config
src/shared/      types and the window.api contract
src/renderer/
  platform/      window.api on top of the Rust commands
  library/       library grid, import, thumbnails
  reader/        ReaderView, layout math, keyboard
    BookStage/   WebGL page-flip renderer, gestures, zoom/pan, turn controller, slide fallback
    annotations/ overlays, selection, highlights, notes, bookmark tabs
    chrome/      hidden toolbar, display menu, idle handling
    ink/         pen input, strokes, undo history
    pdf/         pdf.js service, page cache, text layer
  settings/      settings screen
  stores/        Zustand stores
tests/unit/      Vitest (shared, renderer)
tests/e2e/       Playwright attached to the Tauri app, incl. screenshot and frame-time tests
tests/tauri/     the Rust commands through the real app; installer/ and measure/ next to it
rag-service/     Python RAG service (FastAPI): vector RAG (Chroma), graph RAG (Neo4j), evals
site/            the website (Next.js), deployed to pageturn-wheat.vercel.app
scripts/         release tools; demo-video/ films the app and edits the site's video
docs/superpowers/ design specs
```

---

## Testing

- **205 unit and component tests** (Vitest): page-flip geometry, zoom/pan maths, layout, turn controller, stores, drawing, ink history, toolbar reveal logic.
- **97 Rust unit tests**: repositories against in-memory SQLite, import and hashing, backup, prompts, AI error mapping, argument validation.
- **30 Tauri tests** call every Rust command through the real app, including "Open with", restarts and file drops.
- **42 end-to-end tests** drive the real app: import, reading, curl gestures, highlights across pages, notes, bookmarks, ink, restarts, password PDFs, the WebGL fallback, plus a screenshot test of the page flip and a frame-time test on a 1000-page PDF.

---

Design docs: [`docs/superpowers/specs/`](docs/superpowers/specs/) · components: [`docs/COMPONENTS.md`](docs/COMPONENTS.md) · updates: [`docs/UPDATER.md`](docs/UPDATER.md) · RAG service: [`rag-service/`](rag-service/) · website: [`site/`](site/)
