# PageTurn v1.0.0 — release checklist

Checked on 2026-10-22, branch `reader-redesign`. Spec: `docs/superpowers/specs/2026-10-16-pdf-book-reader-design.md` §1.

## Automated gates

| Gate | Result |
| --- | --- |
| `npm test` (Vitest) | 48 files, 280 tests passed |
| `npm run test:e2e` (Playwright, Electron) | 42 passed |
| `npm run lint` | clean |
| `npm run dist` | `dist/PageTurn-Setup-1.0.0.exe` built (x64, unsigned; compacted from 152 MB to 100 MB) |
| Fuses (`npx @electron/fuses read --app dist/win-unpacked/PageTurn.exe`) | RunAsNode Disabled, CookieEncryption Enabled, NODE_OPTIONS Disabled, CLI inspect Disabled, asar integrity Enabled, OnlyLoadAppFromAsar Enabled |
| Perf spec on the packaged app (`PAGETURN_APP_PATH`) | p95 7.1 ms, max 7.7 ms over 1,753 turn frames (target ≤ 20 ms) |

The packaged build with fuses blocks Playwright, by design: automation needs the inspector that the fuses disable. The perf run used the same packaged app built without fuses (`PAGETURN_NO_FUSES=1 electron-builder --dir`). The fused build was smoke-launched separately. It created the database, logs, the daily backup and the Welcome book.

## Spec §1 success criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 500-page PDF opens in < 2 s; 60 fps turns | Pass (automated) | `reader.spec` opens `text-500.pdf` within its timing budget. Perf spec: p95 7.1 ms per frame on the packaged app. A run on a mid-range integrated-GPU laptop is still to do by hand. |
| 2 | Physical page turn: drag a corner, release to complete or snap back; clicks and keys animate | Pass (automated) | `curl.spec`, `turnController.test` |
| 3 | Annotations persist across restarts and survive moving the PDF (content hash) | Pass (automated) | `annotations.spec` restart tests, `library.spec` relocate |
| 4 | Explain streams a context-aware answer, first token < 3 s; Web shows live results in-app | Partly checked | `help.spec` with the mock provider: streaming, follow-ups, errors, Web tab URL, cancellation. **Human:** with a real Anthropic key, confirm first token < 3 s. |
| 5 | All annotations export to Markdown | Pass (automated) | `markdown.test`, `notebook.spec` (Export Markdown writes `## Page 9`) |
| 6 | Signed-ready NSIS installer for Windows 10/11 x64 | Pass (build) / human install pending | `npm run dist` succeeds unsigned. Signing runs when `CSC_LINK` and `CSC_KEY_PASSWORD` are set. **Human:** install the exe, right-click a PDF → Open with → PageTurn, then uninstall cleanly. |

## Before publishing

- Auto-update reads GitHub Releases from the public repo `GuninderSinghBhatia/pageturn`. Installed apps see an update once a newer release is published.
- The installer is also committed at `installer/PageTurn-Setup-1.0.0.exe` (about 95 MiB, under GitHub's 100 MiB limit).
- Release by pushing a `v*` tag. The `Release` workflow tests, builds and publishes the installer.
