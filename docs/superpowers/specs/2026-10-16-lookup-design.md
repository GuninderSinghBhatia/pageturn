# Look up — design

**Goal:** select a word or phrase in a book, choose **Look up** from the right-click menu,
and get an answer without leaving the book. The reader chooses which site answers.

## Behaviour

- **Wikipedia (the default)** shows an inline card under the selection:
  - article title, short description, the first paragraph of the summary and a thumbnail;
  - **Read on Wikipedia** opens the full article;
  - **Change site** opens Settings.
  - If there is no exact article, the first search hit is used. If nothing is found, the card
    says so and offers to search on Wikipedia instead.
- **Any other site** opens straight away with the phrase as the query. There is no card.
- **Where results open** is a setting:
  - **In-app window** (the default): a small separate, sandboxed window. It has no preload,
    its own session partition, and http(s) only.
  - **Default browser.**

## Settings (Settings → Look up)

| Setting           | Values                                                                                        | Default     |
| ----------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `lookupSite`      | wikipedia, wiktionary, merriam-webster, britannica, google, duckduckgo, custom                | wikipedia   |
| `lookupLanguage`  | Wikipedia / Wiktionary language code (en, es, fr, de, …)                                      | en          |
| `lookupCustomUrl` | https URL containing `{query}`, e.g. `https://www.bing.com/search?q={query}`                  | ''          |
| `lookupOpenIn`    | app, browser                                                                                  | app         |

A custom site is used only once its URL is valid. Until then, Look up falls back to Wikipedia
and Settings shows why.

## Architecture

- `src/shared/lookup.ts` holds the site list and `lookupUrl(settings, query)`. It is pure and
  unit tested.
- Main process `src/main/ipc/lookup.ts` has two handlers:
  - `lookup:wikipedia(query, lang)` fetches the REST summary with `net.fetch`, falling back to
    the search API. It returns `{ title, description, extract, thumbnail (data URL), url }` or
    `null`. Fetching in main keeps the renderer CSP strict (`default-src 'self'`).
  - `lookup:open(url, where)` accepts http(s) URLs only. It opens the in-app look-up window
    (one reused window) or the default browser.
- Renderer: `PhraseCard` gains the Wikipedia view. Ask AI stays "coming soon".
