# Demo video

Films the real PageTurn app and edits it into the website's videos (`site/public/video/`).

```
cd src-tauri && cargo build --no-default-features && cd ..   # debug app the script drives
node scripts/demo-video/make-book.mjs                         # demo book: Alice, ch. I to IV
npx vite --config vite.tauri.config.ts                        # keep running in another terminal
npx tsx scripts/demo-video/record.ts                          # films out/capture.mkv + capture.json
node scripts/demo-video/compose.mjs                           # demo.mp4, poster, feature clips
```

Close any installed PageTurn first: only one copy can run. `make-book`, `compose` and
`shoot-site` launch Chromium; if Playwright reports a missing browser, point `CHROME_PATH` at
an installed `chrome.exe`.

- `record.ts` maximizes the app, drives it over CDP, and films the window with Windows Graphics
  Capture (ffmpeg `gfxcapture`, NVENC) at the screen's rate, up to 144 fps. A magenta flash at the
  start syncs the scene markers to the video; it draws its own pointer because the OS pointer
  isn't moved by the script. The rag-service must be up on :8000 with the book indexed.
- `compose.mjs` resamples the capture to an even 60 fps, then renders a launch-style edit frame by
  frame in Chromium: title cards, numbered feature shots with camera punch-ins, a RAG stats card
  and an end card. It also cuts the 4:3 feature clips for the site.
- Why not the CDP screencast any more: it averaged ~35 fps with freezes up to 0.8 s, while the app
  renders a steady 144 fps. Desktop Duplication (`ddagrab`) fails on this hybrid-GPU laptop
  (the display is owned by the Intel GPU); Graphics Capture works on either.
- `shoot-site.mjs` takes desktop and mobile screenshots of the site for review.

`alice.txt` is Project Gutenberg #11 (public domain).
