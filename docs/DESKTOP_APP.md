# Desktop app: components and sub-components

Detail for part A of [COMPONENTS.md](COMPONENTS.md). Each component lists its
sub-components, with the file that holds each one. Paths are relative to `src/`.

Contents: [1 Shared](#1-shared-contract-shared) · [2 Preload](#2-preload-bridge-preload) ·
[3 Main process](#3-main-process-main) · [4 Renderer](#4-renderer-renderer) ·
[5 Where data lives](#5-where-data-lives) · [6 Cross-cutting rules](#6-cross-cutting-rules)

---

## 1. Shared contract: `shared/`

Used by main, preload and renderer, so a message means the same thing everywhere.

| Sub-component | File        | Role                                                                                                                                             |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain types  | `types.ts`  | book, highlight, note, ink stroke, bookmark, settings                                                                                            |
| IPC contract  | `ipc.ts`    | every channel name (library, reader, rag, settings, ai, app, update, export, web, annotations, window, lookup) and a zod schema for each payload |
| AI types      | `ai.ts`     | request and answer shapes for explain / follow-up                                                                                                |
| Look-up types | `lookup.ts` | Wikipedia result shape and look-up settings                                                                                                      |

## 2. Preload bridge: `preload/`

| Sub-component | File       | Role                                                                                                                   |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bridge        | `index.ts` | exposes `window.api.*` (library, reader, rag, settings, ai, export, web, annotations, window, lookup) and nothing else |
| Typings       | `api.d.ts` | the type of `window.api`, used by the renderer                                                                         |

---

## 3. Main process: `main/`

### 3.1 Start-up and app life

| Sub-component | File          | Role                                                                              |
| ------------- | ------------- | --------------------------------------------------------------------------------- |
| Entry         | `index.ts`    | creates the window, single-instance lock, custom data folder for tests, wires IPC |
| First run     | `firstRun.ts` | adds the bundled Welcome book                                                     |
| Logging       | `logging.ts`  | `userData/logs/main.log`, rotated at 5 MB, nothing sent anywhere                  |
| Updater       | `updater.ts`  | background download, "Restart now"                                                |

### 3.2 IPC handlers: `ipc/`

One file per area; each validates its payload (`validate.ts`) before doing work.

| File             | Area                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `library.ts`     | list, import, open dialog, remove, relocate, read file, save thumbnail, like, change events |
| `reader.ts`      | save reading progress                                                                       |
| `annotations.ts` | highlights, notes, tags, ink, bookmarks, all-notes list                                     |
| `settings.ts`    | settings and API keys (set, has, clear)                                                     |
| `ai.ts`          | test key, list models, explain, follow-up, cancel, token streaming                          |
| `lookup.ts`      | Wikipedia summary, open in window or browser                                                |
| `web.ts`         | in-app web view: show, bounds, back, forward, reload, open external                         |
| `export.ts`      | Markdown export, backup, restore, open data folder                                          |
| `window.ts`      | custom window buttons, aspect fit, state                                                    |
| `rag.ts`         | `rag:health`, `rag:ask`, `rag:who` → HTTP to rag-service on `localhost:8000`                |
| `index.ts`       | registers everything                                                                        |

### 3.3 Database: `db/`

| Sub-component | File                                                               | Role                                                      |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Connection    | `connection.ts`                                                    | SQLite (better-sqlite3, WAL), runs migrations in order    |
| Migrations    | `migrations/001–005`                                               | init, annotations, reader redesign, book likes, note tags |
| Repositories  | `repositories/books.ts`, `annotations.ts`, `ink.ts`, `settings.ts` | all SQL lives here, nothing else touches tables           |
| Retry         | `retry.ts`                                                         | retries a failed save before the UI is told               |

### 3.4 Library: `library/`

| Sub-component | File        | Role                                                                                      |
| ------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Import        | `import.ts` | imports PDFs by content, so a renamed copy updates the path instead of adding a duplicate |
| Book id       | `hash.ts`   | book id = SHA-256 of the first 1 MB plus the file size                                    |

### 3.5 AI providers: `ai/`

| Sub-component      | File                                     | Role                                                                          |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Provider interface | `provider.ts`                            | one shape for every AI service; runs only in main, so keys never reach the UI |
| Providers          | `anthropic.ts`, `openai.ts`, `gemini.ts` | the real services                                                             |
| Mock               | `mock.ts`                                | fixed answers for tests and demos (`PAGETURN_AI_MOCK=1`)                      |
| Session            | `session.ts`                             | keeps chat state, streaming, cancel                                           |
| Prompt             | `prompt.ts`                              | trims the selected text to the context budget                                 |

### 3.6 Other main-process parts

| Sub-component | File                                     | Role                                                                    |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Secrets       | `secrets.ts`                             | API keys encrypted with the OS (safeStorage)                            |
| Web view      | `web/searchView.ts`                      | builds search addresses (with the book title) for the in-app web window |
| Export        | `export/markdown.ts`, `export/backup.ts` | notes to Markdown; full backup and restore                              |

---

## 4. Renderer: `renderer/`

### 4.1 App shell: `app/`

| Sub-component  | File                    | Role                                                         |
| -------------- | ----------------------- | ------------------------------------------------------------ |
| Root           | `App.tsx`               | picks Home or Reader, mounts panels                          |
| Navigation     | `nav.ts`                | current view, home tab, settings overlay                     |
| Theme          | `theme.css`, `theme.ts` | light / sepia / dark tokens; one theme choice for the reader |
| Base styles    | `base.css`              | shared tokens and resets                                     |
| Shortcuts      | `shortcuts.ts`          | key → handler table                                          |
| Window buttons | `WindowControls.tsx`    | minimise, maximise, close (frameless window)                 |
| Toasts         | `Toasts.tsx`            | transient messages, e.g. a failed save                       |
| Onboarding     | `Onboarding.tsx`        | 4-card first-run tour                                        |
| Update notices | `UpdateNotices.tsx`     | "update available / Restart now"                             |

### 4.2 Home: `home/`

| Sub-component | File                                                       | Role                                                                                                                |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Home page     | `HomeView.tsx`                                             | fixed top bar with four sections: Books, Notes, Search Online, Settings                                             |
| Books tab     | `BooksTab.tsx`                                             | the shelf page: filters (All / Reading), search, drag-and-drop import, keyboard (← → Home End Enter), remove dialog |
| Bookshelf     | `BookSlider.tsx`                                           | spines with colour tabs and vertical titles, the focused cover, plank, cover colour from the image                  |
| Selected book | `SelectedBook.tsx`                                         | title, pages, progress, Start/Continue, like, Notes, Details, arrows                                                |
| Notes tab     | `NotesTab.tsx`                                             | all notes across books, "2 days ago" times, opens the book at that page                                             |
| Styles        | `Home.module.css`, `Slider.module.css`, `Notes.module.css` |                                                                                                                     |

### 4.3 Library helpers: `library/`

`thumbnails.ts` (cover images), `displayTitle.ts` (title from metadata or file name),
`RemoveDialog.tsx` (remove, and keep or delete annotations).

### 4.4 Reader: `reader/`

The main screen: one book, nothing but the book.

| Sub-component | File                 | Role                                                        |
| ------------- | -------------------- | ----------------------------------------------------------- |
| Reader screen | `ReaderView.tsx`     | owns the open book, zoom, prefetch, which spread is showing |
| Layout        | `layout.ts`          | spread maths (page 1 is a cover alone on the right)         |
| Keys          | `useReaderKeys.ts`   | reader keyboard shortcuts                                   |
| Size tracking | `useViewport.ts`     | size of the reading area                                    |
| Find          | `FindBar.tsx`        | whole-book search with results per search word              |
| Contents      | `TocSidebar.tsx`     | table of contents                                           |
| Password      | `PasswordPrompt.tsx` | for protected PDFs                                          |
| Sound         | `sound.ts`           | optional page-turn sound, off by default                    |

#### 4.4.1 Book stage: `reader/BookStage/`

| Sub-component   | File                                                                           | Role                                                 |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Stage           | `BookStage.tsx`                                                                | the WebGL two-page book                              |
| Slide fallback  | `SlideStage.tsx`                                                               | used when WebGL is not available                     |
| Page drawing    | `PageCanvas.tsx`                                                               | one page at the right pixel size, retries on failure |
| Page rectangles | `pageRects.ts`                                                                 | where each page sits, centred on the spine           |
| Turn control    | `turnController.ts`, `useTurnGesture.ts`                                       | drag a corner, click an edge, scroll to turn         |
| Pan and zoom    | `usePanZoom.ts`                                                                | zoom 50–400%, drag to pan                            |
| Motion          | `smooth.ts`                                                                    | smooth glide toward a target                         |
| Textures        | `stageTextures.ts`, `bake.ts`                                                  | page bitmaps with annotations painted in             |
| WebGL           | `webgl/renderer.ts`, `shaders.ts`, `textures.ts`, `curlMath.ts`, `flipMath.ts` | the page curl: shaders, GPU textures, the maths      |

#### 4.4.2 PDF layer: `reader/pdf/`

`pdfService.ts` (pdf.js loading), `pageCache.ts` (rendered pages, limited by memory),
`prefetch.ts` (renders nearby spreads ahead), `TextLayer.tsx` (invisible text for selecting).

#### 4.4.3 Reader chrome: `reader/chrome/`

| Sub-component  | File                               | Role                                       |
| -------------- | ---------------------------------- | ------------------------------------------ |
| Hidden toolbar | `ReaderToolbar.tsx`, `reveal.ts`   | slides in at the top edge or with **T**    |
| Idle           | `useIdle.ts`                       | hides the cursor and toolbar after 2 s     |
| Page indicator | `PageIndicator.tsx`                | "12 / 500", click to type a page           |
| Display menu   | `DisplayMenu.tsx`                  | theme, zoom, one or two pages, Settings    |
| Tool state     | `chromeStore.ts`, `useTextTool.ts` | highlighter / underline apply on selection |
| Icons          | `icons.tsx`                        | toolbar icons                              |

#### 4.4.4 Annotations: `reader/annotations/`

| Sub-component     | File                                               | Role                                                                            |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Page overlay      | `PageOverlay.tsx`, `draw.ts`                       | draws highlights, underlines, notes on a page                                   |
| Selection         | `selection.ts`, `rects.ts`, `pageAt.ts`            | turns a text selection into page-relative rectangles                            |
| Selection menu    | `SelectionMenu.tsx`, `selectionActions.ts`         | right-click: note, Ask AI, Look up, highlight, copy, Ask the book, Who is this? |
| Highlight popover | `HighlightPopover.tsx`                             | colour, note, copy, delete                                                      |
| Notes             | `NotePopover.tsx`, `FreeNotes.tsx`, `PageMenu.tsx` | note editor (autosave), sticky notes, "Add note here"                           |
| Bookmarks         | `BookmarkTabs.tsx`, `tabList.ts`                   | pastel tabs on the page edge                                                    |
| Look-up card      | `LookupCard.tsx`                                   | Wikipedia summary beside the page                                               |
| UI state          | `uiStore.ts`                                       | what is open right now                                                          |

#### 4.4.5 Ink: `reader/ink/`

`InkHost.tsx` (pen input), `InkToolbar.tsx` (kind, colour, width, undo/redo),
`strokes.ts` (drawing the strokes), `history.ts` (undo/redo), `inkStore.ts`, `inkInput.ts`.

### 4.5 Ask the book: `ask/`

| Sub-component | File             | Role                                                                                       |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Panel         | `AskPanel.tsx`   | question box, answer, error states, the Spoiler Shield line ("answers only use pages 1–N") |
| State         | `askStore.ts`    | open/closed; `askWho` opens it for "Who is this?"                                          |
| Citations     | `citations.ts`   | turns "(Page 181)" into links that jump the reader                                         |
| Styles        | `Ask.module.css` |                                                                                            |

### 4.6 Help panel: `help/`

| Sub-component | File                                             | Role                                                     |
| ------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Panel         | `HelpPanel.tsx`                                  | resizable right panel with Explain and Web tabs          |
| Explain       | `ExplainTab.tsx`                                 | streamed AI answer, quick actions, follow-ups, key setup |
| Web           | `WebTab.tsx`                                     | in-app web page for the selection                        |
| Context       | `buildContext.ts`, `helpStore.ts`, `openHelp.ts` | builds the request from the selection and the open PDF   |
| Answer text   | `Markdown.tsx`                                   | Markdown with maths (KaTeX) and code highlighting        |

### 4.7 Notebook: `notebook/`

`NotebookPanel.tsx` (left drawer with highlights, notes, bookmarks, ink and export),
`notebookModel.ts` (rows from the annotation store), `notebookStore.ts` (open/closed, Ctrl+B).

### 4.8 Settings: `settings/`

`SettingsView.tsx` (overlay, applies live), `AiSettings.tsx` (providers and keys),
`DataSettings.tsx` (backup, restore, data folder), `AboutSettings.tsx` (version, logs, updates).

### 4.9 State stores: `stores/` (zustand)

| Store                | Holds                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| `libraryStore.ts`    | books, import, like, open; creates covers in the background                |
| `readerStore.ts`     | open book, current page, layout, find, password, turn requests             |
| `annotationStore.ts` | highlights, notes, ink, bookmarks; failed saves kept in memory until Retry |
| `settingsStore.ts`   | settings, theme                                                            |
| `toastStore.ts`      | toasts                                                                     |

---

## 5. Where data lives

| Data                              | Where                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Books list, progress, likes       | SQLite table `books`                                            |
| Highlights, notes, ink, bookmarks | tables `highlights`, `notes`, `ink_strokes`, `bookmarks`        |
| Settings                          | table `settings` (key, JSON value)                              |
| API keys                          | encrypted by the OS, never sent to the UI                       |
| PDF files                         | stay where they are; the app stores the path and a content hash |
| Covers                            | thumbnail folder in the app data directory                      |
| Logs                              | `userData/logs/main.log`                                        |

## 6. Cross-cutting rules

- The renderer never touches files, the database or the network; it calls `window.api`.
- Every IPC message is checked with a zod schema in `shared/ipc.ts`.
- All SQL lives in `main/db/repositories`.
- API keys exist only in the main process.
- A save that fails is retried, then kept in memory and shown as a toast with Retry.
- The reader falls back to a slide transition without WebGL.
