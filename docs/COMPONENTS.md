# PageTurn: components

How the whole project is divided. One line per part: what it does, where it lives, what it
talks to. Paths are relative to the repo root.

## The big picture

```
┌──────────────────────────── Tauri app (TypeScript UI + Rust) ─────────────────────┐
│                                                                                    │
│  Renderer (React UI)  ──window.api────▶  Rust commands ──▶  SQLite (books,        │
│  src/renderer (WebView2)  platform/      src-tauri          notes, ink, settings)  │
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

Rule of thumb: the renderer never touches files, the database or the network. It calls
`window.api`, which invokes a Rust command, and the Rust side does the work.

---

## A. Desktop app (Tauri: React + TypeScript UI, Rust backend)

Every UI sub-component, with its file, is listed in [DESKTOP_APP.md](DESKTOP_APP.md).

### A1. Shared contract: `src/shared/`

Types used by the UI and its tests.

- `types.ts` book, annotation and settings shapes
- `ipc.ts` the `Api` type that `window.api` implements, plus the settings schema
- `ai.ts`, `lookup.ts` shapes for AI and look-up results

### A2. The bridge: `src/renderer/platform/tauriApi.ts`

Builds `window.api` before React starts: each method invokes a Rust command (`library_list`,
`rag_ask`, ...) or subscribes to a Rust event (`library:changed`, `ai:token`, ...). The page
has no other way to reach the computer, and no global Tauri object.

### A3. Rust backend: `src-tauri/`

| Part                               | Where                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Entry, plugins, start-up wiring    | `src/lib.rs`, `src/main.rs`: single instance and "Open with", first-run Welcome book, daily backup, close handling |
| Commands (one file per area)       | `src/commands/`: library, annotations, settings, export, ai, lookup, **rag**, window, app, web                     |
| Database and migrations            | `migrations/*.sql`, `src/db.rs`, `src/models.rs`, `src/state.rs`                                                   |
| Data folder (`%APPDATA%\PageTurn`) | `src/paths.rs`                                                                                                     |
| API keys                           | `src/commands/settings.rs`: encrypted with Windows DPAPI, never sent to the UI                                     |
| AI providers                       | `src/commands/ai.rs`: Anthropic, OpenAI, Gemini and a mock, streamed with `reqwest`                                |
| Signed auto-updater                | `src/updater.rs`; see [UPDATER.md](UPDATER.md)                                                                     |
| Config, icons, permissions         | `tauri.conf.json`, `icons/`, `capabilities/`                                                                       |

Known limit: the Help panel's Web tab is a separate borderless window placed over the panel
(`src/commands/web.rs`), because Tauri's embedded second webview is still unstable.

History and measured results against the old Electron build:
[the migration spec](superpowers/specs/2026-11-25-tauri-migration.md).

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

## B. rag-service (Python + FastAPI): `rag-service/`

A separate local server on `localhost:8000`. The app reaches it through `src-tauri/src/commands/rag.rs`.

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

| Part              | Where                                                           | What it does                                                |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit tests        | `tests/unit/` (renderer, shared)                                | 205 tests, Vitest                                           |
| Rust tests        | `src-tauri/src/**` (`npm run test:rust`)                        | 97 tests                                                    |
| End-to-end tests  | `tests/e2e/`, `tests/fixtures/`                                 | 42 tests, Playwright attached to the real Tauri app         |
| Command tests     | `tests/tauri/`, `tests/installer/`, `tests/measure/`            | Rust commands through the app; installer and updates; speed |
| Build and release | `src-tauri/tauri.conf.json`, `vite.tauri.config.ts`, `scripts/` | build, installer, release script                            |
| Docs              | `docs/`                                                         | progress log, release checklist, specs and plans, this file |

---

## D. How a request travels (example: "Ask the book")

1. You type a question in the Ask panel (`renderer/ask`) while reading page 200.
2. The panel calls `window.api.rag.ask(question, page)`, which invokes the Rust command `rag_ask`.
3. `src-tauri/src/commands/rag.rs` validates it and sends `POST /ask` to `localhost:8000`.
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
