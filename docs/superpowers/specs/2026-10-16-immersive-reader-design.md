# PageTurn — Immersive Reader Redesign: Design Spec

Date: 2026-10-16
Status: Approved in conversation (design sections 1–5); user chose spec → build without a separate plan document.
Source: user's `reader-ui-spec.md` (Dribbble "Ebook Reader App" reference), reconciled with the PDF reader built in Plans 1–2.
Builds on: branch `plan2-annotations`. Supersedes the reader-chrome parts of `2026-10-16-pdf-book-reader-design.md` §4.2 and Plan 3's help *panel* (replaced by cards).

## 1. Goal

Opening a book shows **only the book** on a slate background. Every tool is hidden until summoned: hover the top edge for a toolbar pill, right-click a text selection for a menu. Bookmark tabs on the right page edge are the only other always-visible element.

## 2. Decisions taken

| Topic | Decision |
|---|---|
| Typography (fonts, drop caps, running headers, chapter layout, justification) | **Out of scope.** PDFs render as authored. The Aa menu offers theme, zoom, layout and settings only. |
| Ask AI / Look up | Shown in the selection menu; open a **"coming soon" card**. Built in a follow-up project. |
| Architecture | Rebuild the reader shell in place (approach A). Stage, overlays, stores and DB are kept. |
| Highlight colours | Text highlighter offers 4: yellow, green, blue, pink. Existing purple highlights still render. |
| Bookmark colour | Derived from tab position (cycling pastels); not stored. |

## 3. Layout & theming

- Reader fills the window; **no nav bar, no visible controls**. `F11` toggles fullscreen; `Esc` exits it.
- Background: `linear-gradient(#7F8D9C, #6E7C8B)`; dark theme `#1E1F22`.
- Book fits window height minus **24 px** top and bottom (`fitPageSize` margin 24), centred; page aspect comes from the PDF.
- Whole-book drop shadow ≈ `0 20px 40px rgba(0,0,0,0.25)` (WebGL shadow quad re-tuned; slide stage via CSS). Spine shadow ≈ 8 % darkening fading over ~24 px.
- Automatic layout: **single page when window width < 1000 px or aspect < 1.2**; manual Single/Two pages still overrides.
- Themes (one choice, in Aa menu and Settings), stored as existing `theme` + `paperTint`:
  - Light → `theme: 'light'`, `paperTint: 'cream'`; cream tint = page `#FAF8F4`.
  - Sepia → `theme: 'light'`, `paperTint: 'sepia'`; sepia tint = page `#F4ECD8`.
  - Dark → `theme: 'dark'`, `paperTint: 'dark'`; shader inversion remapped to page `#2A2A2A`, text `#DADADA`.
  - Stored `paperTint: 'white'` displays as Light. The old separate Theme/Paper controls are removed from Settings.
- Book fades in over **250 ms** on open.
- Selection colour `#BFD9F2`.
- **Idle:** after **2 s** without pointer movement the cursor hides and an unpinned toolbar hides. Not in pen/eraser mode.
- Scanned-page notice becomes a toast (no banner).

## 4. Hover toolbar (`ReaderToolbar`)

- Reveal: pointer within the **top 40 px** of the window → pill slides down (`translateY(-100%)→0`, opacity, 180 ms ease-out). Hides **800 ms** after the pointer leaves the pill/zone. `T` toggles.
- Look: floating pill centred 12 px from top, `rgba(30,30,30,0.85)` + `backdrop-filter: blur(12px)`, radius 999 px, padding 6×10 px; 18 px icons, white 80 %; active tool 100 % + highlight circle. Every button has an `aria-label`.
- Contents, left → right: **Back to library · Highlighter · Underline · Pen · Eraser · Bookmark · Contents · Search · page indicator · Aa · Fullscreen**.
  - Highlighter: activates text-highlight tool; a small row of 4 colour swatches appears under the pill while active.
  - Underline: activates underline tool; sub-row toggles Straight / Wavy.
  - Pen: ink pen mode; sub-row = 6 colours, 3 widths, pen/ink-highlighter, Undo, Redo.
  - Eraser: removes ink **and** highlights/underlines/notes under the cursor (highlight removal is not undoable).
  - Bookmark: toggles a bookmark on the lowest visible page.
  - Contents: popover listing the PDF outline; click jumps.
  - Search: inline find input inside the pill (existing find behaviour; Enter jumps).
  - Page indicator: "12 / 500"; click to type a page (`data-testid="page-box"` input). Only place progress is shown.
  - Aa: popover with Light / Sepia / Dark, zoom − / % / +, Single page / Two pages, Settings….
- **Text tools** (highlighter, underline): while active, finishing a selection immediately applies the annotation (style + colour) and clears the selection.
- While any tool is active the pill stays **pinned** and the cursor reflects the tool, until `Esc` (or clicking the tool again).

## 5. Selection menu & notes

- Right-click inside a non-empty text selection → custom menu near the cursor (native menu suppressed). Card: white, radius 8, shadow `0 8px 24px rgba(0,0,0,0.18)`, 13 px sans:
  `Make a note · Ask AI · Look up · — · Highlight · Copy`.
- Right-click on a page with no selection → existing "Add note here" menu (free notes stay).
- **Make a note** (`N`): creates a highlight with style `note` (thin dotted underline) for the selection, then opens a note card beside it: autofocused textarea, autosave on blur and after 500 ms, `Ctrl+Enter` saves and closes, `Esc` closes. A small **margin dot** at the note's first line (outer margin) shows a preview on hover (`title`) and opens the card on click.
- **Ask AI** (`A`) / **Look up**: card anchored to the selection: selected phrase in bold serif, label right, body "Coming soon…". 
- **Highlight** (`H`): highlight in the last-used colour. **Copy**: clipboard.
- All cards close on `Esc`, outside click, or page turn. Cards stay on screen (flip/clamp near edges).
- The floating selection colour toolbar is **removed**.

## 6. Bookmark tabs

- Rendered on the **right-hand visible page** (right page of a spread, or the single page), sticking out past its right edge: 22×60 px, ~6 px overlapping the page, stacked from the top, 4 px apart.
- Top tab: grey, gear icon, opens Settings.
- Then one tab per bookmark in page order, numbered 1…n, colours cycling `#BFD9E8`, `#CFE3C4`, `#EDE3B5`, `#F0D6C2`; the tab for a currently visible page is slightly more prominent.
- Click → jump to page. Hover → tooltip "p. N — first words of the page" (or its label). Right-click → Rename / Delete (rename = inline input; label ≤ 200 chars).
- Setting **"Show bookmark tabs"** (default on) hides the bookmark tabs (the gear tab stays).
- Replaces the corner ribbon (DOM and bake). Tabs are hidden during a turn like other overlays.

## 7. Input

| Input | Action |
|---|---|
| `→` `Space` `PageDown` / `←` `Shift+Space` `PageUp` | next / previous |
| Click left / right **15 %** of the book | previous / next (replaces outer third) |
| Wheel | next / previous (debounced, existing) |
| `T` | toggle toolbar |
| `H` / `N` / `A` | highlight / note / Ask AI on selection |
| `B`, `Ctrl+D` | bookmark lowest visible page |
| `P` / `E` | pen / eraser (existing) |
| `Ctrl+F` | open toolbar with search focused |
| `Ctrl+G` | open toolbar with page box focused |
| `Esc` | close card/menu → exit tool → exit fullscreen |

Shortcuts are ignored while typing (existing rule).

## 8. Data

- Migration `003_reader_redesign.sql`: `ALTER TABLE highlights ADD COLUMN style TEXT NOT NULL DEFAULT 'highlight'`.
- `Highlight.style: 'highlight' | 'underline' | 'wavy' | 'note'` (schema-validated). `drawPageAnnotations` draws: highlight = fill (existing); underline = 1.5 px line under each rect; wavy = sine line; note = dotted line.
- `Api.annotations.renameBookmark(id, label)`.
- Settings: `showBookmarkTabs: boolean` (default `true`).

## 9. Testing

- Unit: style drawing (underline/wavy/note paths), toolbar reveal state machine (top-zone enter, 800 ms leave, pin while tool active, `T`), theme mapping, layout rule (width < 1000), bookmark tab ordering/colours, schema for `style`, repo rename.
- E2E: book opens with no visible toolbar; hovering top edge shows it and it hides after leaving; right-click selection → menu → Make a note persists with dotted underline + margin dot; highlighter tool applies on selection; underline wavy persists; bookmark tabs appear, click jumps, rename/delete; idle hides cursor; existing suites updated to reveal the toolbar (`T`) before using page box / zoom / layout buttons.
- Existing perf (p95 ≤ 20 ms) and curl screenshot must still pass (screenshot baseline re-approved if the background change alters it).
