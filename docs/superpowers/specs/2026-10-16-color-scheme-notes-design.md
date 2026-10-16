# Colour scheme and Notes UI — design

Source: the user's `page-turn-ui-spec.md` ("Day 55 of Daily UI" reference): dark, minimal,
rectangular cards.

## Palette (`src/renderer/app/theme.css`)

**Dark** is the spec palette, used as-is:

| Group    | Tokens                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Surfaces | `--bg #0D0D0D`, `--surface #171717`, `--surface-hover #1E1E1E`, `--border #262626`, `--divider #2E2E2E`              |
| Text     | `--text #EDEDED`, `--muted #8B8B8B`, `--text-faint #5C5C5C`                                                          |
| Accents  | `--accent #1F7A4D` (hover `#23905A`), `--success #22C55E`, `--warning #F5A524`, `--danger #EF4444`, `--info #8B5CF6` |

**Light** keeps the user's earlier request for a light version. It uses the same accent, shapes
and rules on soft off-white surfaces.

**Shared shapes and type:**

- **Radii:** cards `8px` (`--radius-card`), buttons and inputs `4px` (`--radius-control`), tags
  `999px`.
- **Fonts:** Inter for the UI. JetBrains Mono (bundled, `--mono`) for quoted passages.
- **Base size:** 13px.

**Rules:**

- No pure white or pure black.
- Borders are always 1px. Dark has no shadows (`--shadow: none`).
- Only one green primary button per view:
  - home: Start reading;
  - **+ Add books** is outlined;
  - the slider's play button and next arrow are neutral.
- Reader:
  - the floating toolbar and window buttons use the shared `--chrome-*` dark glass;
  - menus, cards and popovers over the book use `--pop-*`, which follows the theme.
- Fonts are never inlined as `data:` URLs, because the CSP allows fonts from `'self'` only.

## Notes page (`src/renderer/home/NotesTab.tsx`, `Notes.module.css`)

**Layout:** grid `repeat(auto-fill, minmax(260px, 1fr))`, gap and padding 16px. Cards have
radius 8, min-height 130, padding 14×16, and an 8px gap between sections.

**Card, top to bottom:**

1. Pencil icon (warning), title, `p. N` badge (green on success-soft).
2. Book · author (11px, muted).
3. Quoted passage: mono, with a 2px accent bar on the left.
4. Note body: 12px muted, line-height 1.55.
5. Tags: outlined pills with a coloured dot (important = red, idea = purple, review = yellow).
6. Reading-progress bar: 4px; track is the divider colour, fill is success.
7. Footer: relative time on the left, **Edit · Delete** on the right (faint).

**Title and body:** the first line of the note is the title and the rest is the body. A first
line longer than 64 characters is cut off, and the full text becomes the body.

**States:**

- Hover uses `--surface-hover` with a divider-coloured border.
- Editing marks the card as selected with an accent border.
- The empty state has muted text and a primary **New note** button, which opens the most
  recently read book.

**Interactions:**

- Clicking a card opens its book at the note's page.
- **Edit** gives a textarea and tag toggles. Ctrl+Enter saves, Esc cancels.
- **Delete** asks for confirmation inline.
- Tag filter chips (All, important, idea, review) sit above the grid. The top-bar search box
  also filters notes by note text, passage or book.

**Data:**

- Migration `005_note_tags.sql` adds `notes.tags_json`.
- Tags change only through `annotations.setNoteTags(id, tags)`. Saving a note from the reader
  never touches them.

## App icon

`build/icon.svg` is the source: an open book on a near-black tile, with a green page turning.
`npm run icons` renders it into:

- `resources/icon.png` (window and taskbar icon on Windows and Linux);
- `build/icon.png`, `build/icon.ico` and `build/icon.icns` (installers);
- `src/renderer/public/favicon.svg` (page favicon).

The home top bar shows the same mark.
