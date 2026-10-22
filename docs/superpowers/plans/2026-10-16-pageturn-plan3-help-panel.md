# PageTurn Plan 3 — Help Panel (Explain AI + Web Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the reader selects text and presses Help (Ctrl+E), a resizable right-side panel opens with an **Explain** tab (streaming, context-aware AI answer from the user's own API key, follow-ups, save-as-note) and a **Web** tab (in-app search results, open-in-browser).

**Architecture:** AI calls run only in the main process through a `Provider` interface (Anthropic, OpenAI, Gemini, plus a Mock); keys are encrypted with Electron `safeStorage` and never enter the renderer. Tokens stream to the renderer over IPC events keyed by `requestId`. The Web tab is a main-owned `WebContentsView` in an isolated session, positioned over a placeholder rect the renderer reports.

**Tech Stack:** Electron `safeStorage`, `WebContentsView`, `session.fromPartition`; `@anthropic-ai/sdk`, `openai`, `@google/genai`; `react-markdown` + `remark-math` + `rehype-katex` + `rehype-highlight`; zod; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md` (§4.5, §4.7 AI/Web parts, §4.8 Ctrl+E/Esc, §7 `ai`/`web`/`settings` key methods, §8 AI/Web rows, §9, §11).

**Prerequisites:** Plan 1 complete. Plan 2 complete for **Task 6 "Save as note"** only (needs `annotations.upsertHighlight` / `upsertNote` and the text-layer selection). If Plan 2 is not done, implement Tasks 1–5 and 7, and leave Task 6 until it is.

## Global Constraints

- Default provider Anthropic, default model `claude-sonnet-5-5`; OpenAI and Gemini selectable; user may override the model id as free text.
- API keys stored encrypted via `safeStorage` in `userData/secrets.bin`, never in SQLite, never sent to the renderer (renderer may only learn `hasApiKey: boolean`).
- Explain context: selected text + full current page text + previous page's last ~800 chars + next page's first ~800 chars + book title + containing outline heading; total capped at ~12,000 chars.
- System prompt intent: explain clearly for a stuck reader; define jargon; short example/analogy; step by step for math/code; flag ambiguity; ≤ ~250 words unless asked for more.
- AI request timeout 30 s. First token target < 3 s with a valid key.
- Web view: partition `persist:websearch`, no preload, no node integration, `setWindowOpenHandler` → `shell.openExternal` + deny; block navigation to non-`http(s)` schemes; deny all permission requests.
- Search engines: DuckDuckGo (default) `https://duckduckgo.com/?q=`, Google `https://www.google.com/search?q=`, Bing `https://www.bing.com/search?q=`. Optional "include book title in query".
- Default tab: Explain if a key exists for the active provider, else Web; user-configurable (`auto | explain | web`).
- Panel width remembered (setting), min 320 px, max 60% of window.
- Mock provider active when env `PAGETURN_AI_MOCK=1`.
- Privacy line shown in Settings and on first Explain: "Only the text you select and nearby page text are sent to your chosen AI provider, and only when you click Explain."

## Review Focus

1. **Selection spanning two pages of a spread** — context built from both pages; selected text joined with a space, not lost. (Task 2 test.)
2. **User switches books or closes the panel mid-stream** — request is cancelled in main, no tokens land in a different panel. (Task 3 + Task 5 tests.)
3. **Very long selection (> 12k chars)** — selection itself truncated with "…" and context dropped first; request still sent. (Task 2 test.)
4. **Web page tries `window.open`, `file:` link, or camera permission** — opened externally / blocked / denied; app window never navigates. (Task 4 test.)
5. **Key saved, then OS user profile changes so `safeStorage` can't decrypt** — `hasApiKey` returns false and Settings asks to re-enter, no crash. (Task 1 test.)

---

## File Structure

```
src/shared/ai.ts                    ExplainRequest, ChatMessage, ProviderId, AiError types + zod
src/main/secrets.ts                 SecretStore
src/main/ai/prompt.ts               buildExplainMessages, capContext
src/main/ai/provider.ts             Provider interface, getProvider
src/main/ai/anthropic.ts, openai.ts, gemini.ts, mock.ts
src/main/ai/session.ts              AiSessionManager (requestId → history, AbortController)
src/main/ipc/ai.ts, web.ts          handlers
src/main/web/searchView.ts          SearchViewManager
src/preload/index.ts                + api.ai, api.web, settings key methods
src/renderer/help/HelpPanel.tsx, ExplainTab.tsx, WebTab.tsx, Markdown.tsx, helpStore.ts, buildContext.ts
src/renderer/reader/SelectionToolbar.tsx   (+ Help button; created in Plan 2 — create minimal version if absent)
src/renderer/settings/AiSettings.tsx
tests/unit/main/{secrets,prompt,session,searchView}.test.ts
tests/unit/renderer/{buildContext,helpStore}.test.ts
tests/e2e/help.spec.ts
```

---

### Task 1: Secrets store and AI settings

**Files:**
- Create: `src/shared/ai.ts`, `src/main/secrets.ts`, `src/renderer/settings/AiSettings.tsx`; Modify: `src/shared/types.ts` (Settings), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/settings.ts`, `SettingsView.tsx`
- Test: `tests/unit/main/secrets.test.ts`

**Interfaces:**
- Produces:
```ts
type ProviderId = 'anthropic' | 'openai' | 'gemini';
// Settings additions (defaults):
aiProvider: ProviderId = 'anthropic'; aiModel: string | null = null; // null → provider default
searchEngine: 'duckduckgo'|'google'|'bing' = 'duckduckgo'; searchIncludeTitle: boolean = false;
helpDefaultTab: 'auto'|'explain'|'web' = 'auto'; helpPanelWidth: number = 420; aiPrivacyAcknowledged: boolean = false;
const DEFAULT_MODELS: Record<ProviderId, string> = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5', gemini: 'gemini-2.5-pro' };
class SecretStore { constructor(file: string, crypto: { isAvailable(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string });
  set(p: ProviderId, key: string): void; get(p: ProviderId): string | null /* null on missing OR decrypt failure */;
  has(p: ProviderId): boolean; clear(p: ProviderId): void }
// Api additions:
settings.setApiKey(p: ProviderId, key: string): Promise<void>; settings.hasApiKey(p: ProviderId): Promise<boolean>;
settings.clearApiKey(p: ProviderId): Promise<void>; ai.testKey(p: ProviderId): Promise<{ ok: true } | { ok: false; error: AiError }>;
type AiError = { kind: 'no_key' | 'invalid_key' | 'rate_limit' | 'offline' | 'timeout' | 'provider'; message: string };
```
  File format: JSON `{ [provider]: base64(encrypted) }`. If `isAvailable()` false, `set` throws `SecretsUnavailableError` and Settings shows "Secure storage unavailable on this system".

- [ ] **Step 1: Failing tests** (fake crypto that reverses strings; a "broken" fake whose `decrypt` throws): set→get round-trips; file never contains the plaintext key; `has` false after `clear`; broken decrypt → `get` returns `null`, `has` false (Review Focus 5); `isAvailable` false → `set` throws `SecretsUnavailableError`.
- [ ] **Step 2:** `npx vitest run tests/unit/main/secrets.test.ts` → FAIL.
- [ ] **Step 3:** Implement `SecretStore`, IPC handlers (zod: key non-empty string ≤ 512 chars), `AiSettings` UI: provider select, masked key input + Save + Clear + "Test key" (calls `ai.testKey`, shows ✓ or error message), model override input with placeholder = `DEFAULT_MODELS[provider]`, search engine select, include-title toggle, default tab select, privacy line. `ai.testKey` may return `{ok:false, error:{kind:'provider', message:'Not implemented'}}` until Task 3.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: encrypted API key storage and AI settings`.

### Task 2: Prompt and context builder

**Files:**
- Create: `src/main/ai/prompt.ts`, `src/renderer/help/buildContext.ts`; Test: `tests/unit/main/prompt.test.ts`, `tests/unit/renderer/buildContext.test.ts`

**Interfaces:**
- Consumes: `OpenedDoc.getText`, `OutlineItem` (Plan 1 Task 5).
- Produces:
```ts
type ExplainRequest = { bookTitle: string | null; heading: string | null; selection: string; pages: number[];
  pageText: string; prevTail: string; nextHead: string };
// renderer
function buildExplainRequest(doc: OpenedDoc, selection: { text: string; pages: number[] }, bookTitle: string | null): Promise<ExplainRequest>;
function headingForPage(outline: OutlineItem[], page: number): string | null;  // deepest item whose page ≤ target, in document order
// main
const MAX_CONTEXT = 12_000; const NEIGHBOR_CHARS = 800;
function capContext(r: ExplainRequest): ExplainRequest;   // drop order: prevTail, nextHead, then trim pageText around the selection; finally truncate selection to MAX_CONTEXT-200 chars + '…'
function buildExplainMessages(r: ExplainRequest): { system: string; messages: ChatMessage[] };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
```
  `pageText` = text of all `pages` joined with `\n\n`; `prevTail` = last 800 chars of page `min(pages)-1`; `nextHead` = first 800 of `max(pages)+1` (empty string at book bounds). User message format:
  ```
  Book: {title}\nSection: {heading}\n\n<context_before>{prevTail}</context_before>\n<page>{pageText}</page>\n<context_after>{nextHead}</context_after>\n\nI'm stuck on this part:\n<selection>{selection}</selection>\n\nExplain it.
  ```
  (omit Book/Section lines when null).

- [ ] **Step 1: Failing tests:** selection on pages [4,5] → `pageText` contains both pages' text and `prevTail` comes from page 3 (Review Focus 1); page 1 → `prevTail` `''`; `headingForPage` with nested outline picks the deepest matching heading; `capContext` with 20k-char `pageText` yields total length (sum of all string fields) ≤ 12,000 and still contains the selection; 15k-char selection → truncated, ends with `…`, prevTail/nextHead empty (Review Focus 3); `buildExplainMessages` system prompt contains "define" and "step by step" and "250 words"; user message contains `<selection>`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: explain prompt and context builder`.

### Task 3: Providers, streaming sessions, AI IPC

**Files:**
- Create: `src/main/ai/provider.ts`, `anthropic.ts`, `openai.ts`, `gemini.ts`, `mock.ts`, `session.ts`, `src/main/ipc/ai.ts`; Modify: preload, `shared/ipc.ts`
- Test: `tests/unit/main/session.test.ts`

**Interfaces:**
- Consumes: `SecretStore`, `buildExplainMessages`, `capContext`, settings.
- Produces:
```ts
interface Provider { id: ProviderId | 'mock';
  stream(args: { key: string; model: string; system: string; messages: ChatMessage[]; signal: AbortSignal },
         onToken: (t: string) => void): Promise<void>;   // throws AiError-shaped errors via toAiError()
  test(key: string, model: string): Promise<void> }
function getProvider(id: ProviderId): Provider;   // returns MockProvider when PAGETURN_AI_MOCK=1
function toAiError(e: unknown): AiError;   // 401/403→invalid_key, 429→rate_limit, ENOTFOUND/ECONNREFUSED/fetch failed→offline, AbortError from timeout→timeout, else provider
class AiSessionManager { constructor(deps: { secrets; settings; send: (channel: string, payload: unknown) => void; timeoutMs = 30_000 });
  explain(requestId: string, req: ExplainRequest): Promise<void>;   // stores system+messages history, streams
  followUp(requestId: string, text: string): Promise<void>;          // appends user msg, streams; unknown id → ai:error provider
  cancel(requestId: string): void; cancelAll(): void }
// IPC events to renderer:
'ai:token' { requestId, token } · 'ai:done' { requestId, text } · 'ai:error' { requestId, error: AiError }
// Api additions: ai.explain(requestId, req), ai.followUp(requestId, text), ai.cancel(requestId),
// ai.onToken(cb), ai.onDone(cb), ai.onError(cb) → unsubscribe fns
```
  Mock: emits `"Mock explanation of: {first 40 chars of selection}"` in 5-char tokens, 20 ms apart; if selection contains `__FAIL_RATE__` throws a 429. Anthropic uses `messages.stream` with `max_tokens: 1024`; OpenAI `chat.completions.create({stream:true})`; Gemini `generateContentStream`. Assistant reply appended to history on done. Timeout = abort after 30 s with no completion → `timeout`.
  Cancel all sessions when the reader closes the book (renderer calls `ai.cancel` for its active id; main also cancels all on window reload).

- [ ] **Step 1: Failing tests** (with an injected fake provider): no key → single `ai:error` `no_key`, no tokens; tokens arrive in order then `ai:done` with concatenated text; `followUp` sends history of 3 messages (user, assistant, user); `cancel` mid-stream → provider's signal aborted, no further `ai:token`, no `ai:done` (Review Focus 2); fake hang + `timeoutMs: 50` → `timeout`; `toAiError({status:401})` → `invalid_key`, `{status:429}` → `rate_limit`, `TypeError('fetch failed')` → `offline`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (wire `ai.testKey` to `provider.test`) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: AI providers with streaming, follow-ups and cancellation`.

### Task 4: Web search view (main)

**Files:**
- Create: `src/main/web/searchView.ts`, `src/main/ipc/web.ts`; Modify: preload, `shared/ipc.ts`
- Test: `tests/unit/main/searchView.test.ts`

**Interfaces:**
- Produces:
```ts
type Bounds = { x: number; y: number; width: number; height: number };   // CSS px in window content coords, integers
function searchUrl(engine: 'duckduckgo'|'google'|'bing', query: string, bookTitle: string | null, includeTitle: boolean): string;  // encodeURIComponent; title appended in quotes when includeTitle && title
function isAllowedNavigation(url: string): boolean;   // http: / https: only
class SearchViewManager { constructor(win: BrowserWindow, opts?: { createView?: () => WebContentsView });
  show(url: string, bounds: Bounds): void; setBounds(b: Bounds): void; hide(): void;   // hide removes from contentView, keeps history
  back(): void; forward(): void; reload(): void; openExternal(): void; currentUrl(): string | null;
  onState(cb: (s: { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; error: string | null }) => void): void }
// Api additions: web.show(query, bounds), web.setBounds(b), web.hide(), web.back(), web.forward(), web.reload(), web.openExternal(), web.onState(cb)
```
  View created lazily with `webPreferences: { partition: 'persist:websearch', nodeIntegration: false, contextIsolation: true, sandbox: true }` (no preload). Session hardening once: `setPermissionRequestHandler((_,_,cb)=>cb(false))`. `setWindowOpenHandler` → `shell.openExternal(url)` if allowed, return `{action:'deny'}`. `will-navigate` → `preventDefault` when `!isAllowedNavigation`. `did-fail-load` (not `-3` aborted) → state `error: 'offline'`. Main resolves `query` → url using settings + current book title (renderer passes title in payload).

- [ ] **Step 1: Failing tests:** `searchUrl('duckduckgo','what is entropy',null,false)` = `https://duckduckgo.com/?q=what%20is%20entropy`; with title `Physics` and include → query ends `%20%22Physics%22`; google/bing prefixes exact; `isAllowedNavigation` true for `https://x`, false for `file:///C:/`, `javascript:alert(1)`, `ms-settings:`; with a fake view: window-open handler returns `deny` and calls `shell.openExternal` only for https; permission handler denies (Review Focus 4); `hide` then `show` reuses the same view.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: sandboxed in-app web search view`.

### Task 5: Help panel UI (renderer)

**Files:**
- Create: `src/renderer/help/helpStore.ts`, `HelpPanel.tsx`, `ExplainTab.tsx`, `WebTab.tsx`, `Markdown.tsx`; Modify: `ReaderView.tsx` (layout: book area shrinks when panel open), `SelectionToolbar.tsx` (Help button; if Plan 2 absent, create minimal toolbar that appears on `selectionchange` over the text layer with only "Help")
- Test: `tests/unit/renderer/helpStore.test.ts`, `tests/e2e/help.spec.ts`

**Interfaces:**
- Consumes: `buildExplainRequest`, `api.ai.*`, `api.web.*`, settings, `useReaderStore` (`bookId`, `doc`).
- Produces:
```ts
useHelpStore: { open: boolean; tab: 'explain' | 'web'; selection: { text: string; pages: number[] } | null;
  requestId: string | null; messages: { role: 'user'|'assistant'; content: string; streaming?: boolean }[];
  error: AiError | null; webQuery: string;
  openFor(sel, opts: { hasKey: boolean; defaultTab: 'auto'|'explain'|'web' }): void;   // cancels previous requestId
  setTab(t): void; close(): void /* cancels */; ask(text: string): void; quick(kind: 'simpler'|'detail'|'example'|'translate', lang?: string): void;
  retry(): void }
```
  Quick-action prompts: simpler → "Explain that more simply, like I'm new to the topic."; detail → "Go into more detail."; example → "Give me a concrete example."; translate → "Translate the selected passage into {lang} and explain it in {lang}." Token events whose `requestId` ≠ current are ignored (Review Focus 2).
  Explain tab: streamed Markdown (KaTeX, code highlight), quick-action chips, follow-up input, Copy, "Save as note" button (disabled with tooltip "Requires annotations" until Task 6). No key → setup card "Add an API key to get explanations" + "Open Settings" + "Search the web instead". Error → message per `kind` + Retry (`invalid_key`/`no_key` → Open Settings). First use with `aiPrivacyAcknowledged` false → privacy line + "Got it" before sending.
  Web tab: toolbar (back, forward, reload, editable query + Enter, engine select, Open in browser) and a placeholder `div` whose `getBoundingClientRect()` is sent to `web.setBounds` via `ResizeObserver` + window resize (rounded ints); `web.hide()` when tab inactive, panel closed, or any modal opens. Offline state → friendly card + Retry.
  Panel: right side, drag handle resizes (min 320, max 60%), width saved to `helpPanelWidth`. Shortcuts: Ctrl+E opens with current selection (no selection → toast "Select some text first"), Esc closes.

- [ ] **Step 1: Failing store tests:** `openFor` with `hasKey:false, defaultTab:'auto'` → tab `web`; with key → `explain`; `openFor` twice → `api.ai.cancel` called with first id; token for stale id ignored; `close` cancels; `quick('simpler')` sends the exact prompt via `followUp`.
- [ ] **Step 2: Failing e2e** (`PAGETURN_AI_MOCK=1`, key set via `api.settings.setApiKey('anthropic','sk-test')`): open `text-500.pdf`, select text on page, Ctrl+E → panel visible, text "Mock explanation of:" appears within 3 s; type follow-up → second answer appears; select text containing `__FAIL_RATE__` (fixture page with that string — add to `make-fixtures.ts`) → rate-limit message + Retry; switch to Web tab → `web.onState` url starts `https://duckduckgo.com/?q=`; Esc closes panel and web view hidden.
- [ ] **Step 3:** FAIL → **Step 4:** implement → **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat: help panel with explain and web tabs`.

### Task 6: Save explanation as note (requires Plan 2)

**Files:**
- Modify: `ExplainTab.tsx`, `helpStore.ts`; Test: add to `tests/e2e/help.spec.ts`

**Interfaces:**
- Consumes (Plan 2): `annotationStore.addHighlight(page, rects, text, color) → Highlight`, `annotationStore.upsertNote(note) → Note`, `Highlight.noteId`. Selection must carry `rects` per page — extend `selection` to `{ text; pages; rects: Record<number, Rect[]> }` (Plan 2's SelectionToolbar already computes them).
- Produces: `helpStore.saveAsNote(): Promise<void>` — if a highlight with identical page+text exists reuse it, else create yellow highlight(s) (one per page); note body = `**Explanation (AI):**\n\n{last assistant message}`; attach to the first highlight; toast "Saved to notes".

- [ ] **Step 1: Failing e2e:** after a mock explanation, click "Save as note" → highlight visible on page and notebook/annotation API lists a note whose body contains "Mock explanation of:"; clicking twice does not create a second highlight.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: save AI explanation as note`.

### Task 7: Hardening pass and full verification

**Files:**
- Modify: `src/main/index.ts` (call `aiSessions.cancelAll()` on `render-process-gone`/reload, `searchView.hide()` on book close), `ReaderView.tsx` (close panel + cancel on book switch)
- Test: add to `tests/e2e/help.spec.ts`

- [ ] **Step 1: Failing e2e:** start a mock explanation, immediately go back to library and open another book → no panel shown, no tokens appear later (Review Focus 2); grep the DB file and `localStorage` dump for `sk-test` → absent (key only in `secrets.bin`, encrypted).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Run `npm test && npm run test:e2e && npm run lint` → all green. Manually (human): with a real Anthropic key, select a paragraph, confirm first token < 3 s.
- [ ] **Step 6:** Commit `chore: help panel lifecycle hardening`.

---

## Done criteria for Plan 3
Select text → Ctrl+E/Help opens the panel; Explain streams a context-aware answer from the user's own key with follow-ups, quick actions, clear errors and (with Plan 2) save-as-note; Web shows sandboxed in-app search with back/forward and open-in-browser; keys are encrypted and never reach the renderer. All tests pass.
