# PageTurn: components

How the whole project is divided. One line per part: what it does, where it lives, what it
talks to. Paths are relative to the repo root.

## The big picture

```
┌──────────────────────────── Electron app (TypeScript) ───────────────────────────┐
│                                                                                    │
│  Renderer (React UI)  ──preload bridge──▶  Main process  ──▶  SQLite (books,      │
│  src/renderer             src/preload       src/main          notes, ink, settings)│
│                                                  │                                 │
│                                                  ├──▶ AI providers (Anthropic /    │
│                                                  │     OpenAI / Gemini)            │
│                                                  ├──▶ Wikipedia / web lookup       │
│                                                  └──▶ HTTP localhost:8000 ─────────┼──┐
└────────────────────────────────────────────────────────────────────────────────────┘  │
                                                                                         ▼
┌──────────────────────────── rag-service (Python, FastAPI) ───────────────────────────┐
│  /ask  /who  /health ── ask.py ── Chroma (vector search) ── Groq (answers)           │
│                           │                                                           │
│                           ├── tree.py + retrievers.py  (chapter tree, hybrid)         │
│                           └── graph/  ── Neo4j (graph RAG, in progress)               │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Rule of thumb: the renderer never touches files, the database or the network. It asks the
main process through the preload bridge, and the main process does the work.

---

## A. Desktop app (Electron + React + TypeScript)

Every sub-component, with its file, is listed in [DESKTOP_APP.md](DESKTOP_APP.md).

### A1. Shared contract: `src/shared/`

Types and message definitions used by every other part of the app.

- `types.ts` book, annotation and settings shapes
- `ipc.ts` channel names and zod schemas that validate every message (including the RAG ones)
- `ai.ts`, `lookup.ts` shapes for AI and look-up results

### A2. Preload bridge: `src/preload/`

The only door between the UI and the main process. Exposes `window.api.*` and its types
(`api.d.ts`). Nothing else from Node reaches the UI.

### A3. Main process: `src/main/`

Runs the app window and everything that needs the computer.

| Part          | Where                                   | What it does                                                                                                                            |
| ------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| App start-up  | `index.ts`, `firstRun.ts`, `logging.ts` | creates the window, single-instance lock, first-run sample book                                                                         |
| IPC handlers  | `ipc/*.ts`                              | one file per area: library, reader, annotations, settings, ai, lookup, web, export, window, **rag**. `validate.ts` checks every payload |
| Database      | `db/`                                   | SQLite connection, 5 migrations, repositories for books, annotations, ink, settings                                                     |
| Library       | `library/`                              | PDF import and file hashing (same file is not added twice)                                                                              |
| AI providers  | `ai/`                                   | Anthropic, OpenAI, Gemini and a mock, behind one `provider.ts`; `session.ts` keeps chat state, `prompt.ts` builds prompts               |
| Secrets       | `secrets.ts`                            | API keys encrypted with the OS (Electron safeStorage)                                                                                   |
| Web / look-up | `web/searchView.ts`, `ipc/lookup.ts`    | Wikipedia cards and the in-app web window                                                                                               |
| Export        | `export/`                               | backup and Markdown export of notes                                                                                                     |
| Updates       | `updater.ts`                            | background updates with "Restart now"                                                                                                   |

### A4. Renderer (UI): `src/renderer/`

| Component       | Where                 | What it does                                                                                                     |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App shell       | `app/`                | navigation, theme (light / sepia / dark), toasts, onboarding, window buttons, keyboard shortcuts, update notices |
| Home            | `home/`               | **bookshelf** (spines, focused cover, All / Reading filters), selected-book panel, Notes tab, search             |
| Library helpers | `library/`            | thumbnails, display titles, remove dialog                                                                        |
| Reader          | `reader/`             | the PDF book view: `ReaderView`, find bar, table of contents, password prompt                                    |
| Book stage      | `reader/BookStage/`   | two-page spread, WebGL page curl (`webgl/`), slide fallback, page canvases                                       |
| PDF layer       | `reader/pdf/`         | pdf.js rendering, text layer for selection                                                                       |
| Reader chrome   | `reader/chrome/`      | hidden toolbar, page indicator, display menu                                                                     |
| Annotations     | `reader/annotations/` | highlights, underlines, notes, bookmarks, selection menu, look-up card                                           |
| Ink             | `reader/ink/`         | pen and eraser drawing                                                                                           |
| Ask panel       | `ask/`                | "Ask the book" drawer with page citations and the Spoiler Shield line; also hosts "Who is this?"                 |
| Help panel      | `help/`               | Explain and Web tabs (AI explanation of a selection)                                                             |
| Notebook        | `notebook/`           | all notes for a book in one panel                                                                                |
| Settings        | `settings/`           | AI keys, data and backup, about                                                                                  |
| State stores    | `stores/`             | zustand stores: library, reader, annotations, settings, toasts                                                   |

---

## A2. Tauri build (Rust): `src-tauri/`

The same React UI, with a Rust backend instead of the Electron main process. `window.api` is provided by
`src/renderer/platform/tauriApi.ts`, which calls Rust commands by name.

| Part                                                     | Where                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Entry, plugins, start-up wiring                          | `src/lib.rs`, `src/main.rs`                                                                                           |
| Commands (one file per area)                             | `src/commands/`: library, annotations, settings, export, ai, lookup, rag, window, app, web                            |
| Database and migrations (same SQL files as Electron)     | `src/db.rs`, `src/models.rs`, `src/state.rs`                                                                          |
| Data folder (`%APPDATA%\PageTurn`, shared with Electron) | `src/paths.rs`                                                                                                        |
| Signed auto-updater                                      | `src/updater.rs`; see [UPDATER.md](UPDATER.md)                                                                        |
| Config, icons, permissions                               | `tauri.conf.json`, `icons/`, `capabilities/`                                                                          |
| Tests                                                    | Rust unit tests in each file; `tests/tauri/` (real app), `tests/installer/` (installer and updates), `tests/measure/` |

Details and measured results: [the migration spec](superpowers/specs/2026-11-25-tauri-migration.md).

---

## B. rag-service (Python + FastAPI): `rag-service/`

A separate local server on `localhost:8000`. The app reaches it through `src/main/ipc/rag.ts`.

| Part           | Where                      | What it does                                                                                                              |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| API            | `main.py`                  | `GET /health`, `POST /ask`, `POST /who`                                                                                   |
| Ingest         | `page_number.py`           | PDF → chunks (500 characters, 100 overlap) with `book_id` and 1-based `page`                                              |
| Index          | `index_book.py`            | embeds chunks with all-MiniLM-L6-v2 and stores them in Chroma                                                             |
| Ask            | `ask.py`                   | `retrieve`, `build_prompt`, `ask_question` (Groq model), **Spoiler Shield** (`current_page`), `who_is` (keyword + vector) |
| Tree retrieval | `tree.py`, `retrievers.py` | chapter/section tree with LLM summaries; `RAG_RETRIEVER=vector\|tree\|hybrid`                                             |
| Evals          | `evals/`                   | 25 answerable + 4 off-topic questions, `run_evals.py`, `results.csv`                                                      |
| Tests          | `tests/`                   | spoiler, tree and who-is tests (16 pass)                                                                                  |
| Scratch        | `scratch/`                 | the learner's experiments, not part of the service                                                                        |
| Local data     | `data/` (git-ignored)      | Chroma database, `tree.json`                                                                                              |

### B1. Graph RAG (in progress): `rag-service/graph/`

Roadmap: `rag-service/GRAPH_RAG.md` (G0–G7). Neo4j in Docker, LangChain
(`langchain-neo4j`, `LLMGraphTransformer`), MiniLM embeddings.

- Done so far: Neo4j running, three test facts created, Python connects and stores/searches
  test documents (`graph/playground.py`).
- Next: use real book chunks as `docs`, extract nodes and links from them (G1).

---

## C. Quality and tooling

| Part              | Where                                                         | What it does                                                |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit tests        | `tests/unit/` (main, renderer, shared)                        | 289 tests, Vitest                                           |
| End-to-end tests  | `tests/e2e/`, `tests/fixtures/`                               | 44 tests, Playwright drives the real Electron app           |
| Build and release | `electron.vite.config.ts`, `electron-builder.yml`, `scripts/` | build, icons, installer, release script                     |
| Docs              | `docs/`                                                       | progress log, release checklist, specs and plans, this file |

---

## D. How a request travels (example: "Ask the book")

1. You type a question in the Ask panel (`renderer/ask`) while reading page 200.
2. The panel calls `window.api.rag.ask(question, page)` (preload).
3. `main/ipc/rag.ts` validates it and sends `POST /ask` to `localhost:8000`.
4. `ask.py` finds the best chunks in Chroma, checks the Spoiler Shield, asks Groq, and
   returns an answer with page numbers.
5. The panel shows the answer; clicking a page number jumps the reader to it.

---

## E. Known gaps

- The app asks one indexed book (`book1`), whatever book is open. A `book_id` filter is needed.
- The rag-service must be started by hand; the app does not launch it.
- "Previously on…" (M7) and "Talk to a character" (M9) were skipped.
- Spoiler Shield and "Who is this?" are tested against the service, not clicked through in the app.
- Graph RAG is at its first steps (see B1).
