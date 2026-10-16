# PageTurn — Home Page Redesign: Design Spec

Date: 2026-10-16 · Status: approved in conversation (spec → build) · Source: user's `main-page-ui.md` (dark game-library grid, adapted for books).

## 1. Goal
The home screen becomes a dark, app-style page: a fixed **top navigation bar** with four tabs, and a scrollable **grid of all books** under it. No sidebar, no "Latest" row. The reader is unchanged.

## 2. Decisions
| Topic | Decision |
|---|---|
| Search Online | **Placeholder tab**: search box + "coming soon" card. No network yet. |
| Library folder setting | **Skipped.** |
| Light version | **Yes.** Dark palette when the app theme is Dark; same layout in a light palette (same purple accent) for Light / Sepia. |
| Font | **Inter**, bundled with the app (`@fontsource-variable/inter`); the CSP blocks web fonts. |
| Font size / reading mode | Not applicable to PDFs; Settings keeps theme, page turn, layout, pen, bookmarks. |

## 3. Top navigation bar
- Fixed at the top, stays visible while scrolling; draggable for moving the window (buttons excluded); right padding for the window controls.
- Left: logo (book glyph + "PageTurn"). Centre-left: tabs **Books · Notes · Search Online · Settings** (`role="tablist"`); the active tab gets a purple pill.
- Right: a search icon that expands into an input filtering the current Books grid by title/author; **Add books** button (file dialog; drag-and-drop onto the window still works).

## 4. Books (default tab)
- Responsive grid: `repeat(auto-fill, minmax(168px, 1fr))` → about 6 columns on wide windows; 20 px gap; vertical scroll only.
- Card: 2:3 cover, radius 10, soft shadow; hover scales 1.03 and adds a purple glow; click opens the book at its last-read page.
- Detail section: **title** (bold, one line, ellipsis) · **author** (muted, one line) with a **heart** button on the right (♡ → filled purple ♥; `aria-pressed`) · **"Page 45 / 320"** · thin purple progress bar.
- Missing files keep the "Missing / Relocate" treatment; right-click keeps "Remove from library".
- Sort order: recently opened first (the separate sort control is dropped).
- Empty state: friendly card with **Add books** and "or drop PDFs here".

## 5. Notes tab
- Every note across all books, grouped by book: group header = small cover + title + author.
- Each note: its text, the highlighted passage (if it is attached to a highlight), "Page N", created date.
- Click a note → opens that book at that page.
- Empty state when there are no notes.

## 6. Search Online tab (placeholder)
- Search input at top; below, a card: "Online search is coming soon — for now, add PDFs with Add books or drag them in."

## 7. Settings tab
- The existing Settings content rendered inside the tab (no back button). The reader still opens Settings as an overlay.

## 8. Visual style
| Token | Dark | Light |
|---|---|---|
| Background | `#1A1B2E` | `#F4F4FA` |
| Card / bar | `#24253D` | `#FFFFFF` |
| Text primary | `#FFFFFF` | `#1A1B2E` |
| Text secondary | `#A0A3BD` | `#6B6E8A` |
| Accent | `#7B5CFF` | `#7B5CFF` |
Spacing 16–24 px, radius 8–12 px.

## 9. Data / IPC
- Migration `004_book_likes.sql`: `ALTER TABLE books ADD COLUMN liked INTEGER NOT NULL DEFAULT 0`.
- `Book.liked: boolean`; `api.library.setLiked(bookId, liked)`.
- `api.annotations.listAllNotes()` → `{ book: Book-lite, notes: { note, quote | null }[] }[]` (books with notes, most recent first).
- `nav.goReader(bookId, page?)`: opening at a given page (notes) overrides the saved position once.

## 10. Testing
Unit: repo `setLiked` + `listAllNotes` grouping/quotes; schema; LibraryView card (heart toggles, page text, progress); tabs switch. E2E: home shows tabs and grid; like persists across restart; Notes tab lists a note and opens its page; Search Online shows the placeholder; Settings tab works; existing library/remove tests updated.
