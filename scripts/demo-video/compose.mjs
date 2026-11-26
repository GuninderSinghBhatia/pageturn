// Edits the filmed take (record.ts → out/capture.mkv + out/capture.json) into a launch-style video:
//   site/public/video/demo.mp4      the tour: title cards, feature shots with camera moves, RAG stats
//   site/public/video/poster.jpg    its still
//   site/public/video/clips/*.mp4   4:3 feature loops for the site's feature player (+ .jpg posters)
//
//   CHROME_PATH=<chrome.exe> node scripts/demo-video/compose.mjs
//
// Every output frame is drawn by Chromium (so type and colours match the website) and piped to
// ffmpeg. App footage is the 144 fps capture resampled to an even 60 fps; sped-up parts blend
// neighbouring frames instead of dropping them.
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname
const OUT = join(here, 'out')
const WORK = join(OUT, 'compose')
const SITE = join(here, '..', '..', 'site', 'public', 'video')
const CAPTURE = join(OUT, 'capture.mkv')
const CFR = join(OUT, 'capture-60.mkv')
const FPS = 60
const W = 1920
const H = 1080

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
mkdirSync(join(SITE, 'clips'), { recursive: true })

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 30 })

// ---- Source: even 60 fps, and marker times on the video's clock --------------------------------

if (!existsSync(CFR) || statSync(CFR).mtimeMs < statSync(CAPTURE).mtimeMs) {
  console.log('resampling the capture to 60 fps…')
  ff(['-i', CAPTURE, '-vf', 'fps=60', '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', '12', '-g', '30', CFR])
}
const cap = JSON.parse(readFileSync(join(OUT, 'capture.json'), 'utf8'))
const SRC_W = Math.round(cap.view.w * cap.view.dpr)
const SRC_H = Math.round(cap.view.h * cap.view.dpr)

/** Video time of the magenta flash record.ts showed at `cap.flash` (wall clock). */
function flashTime() {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-t', '8', '-i', CFR, '-vf', 'scale=4:4,format=rgb24', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 26 })
  for (let i = 0; i * 48 < raw.length; i++) {
    const [r, g, b] = raw.subarray(i * 48 + 15, i * 48 + 18)
    if (r > 200 && b > 200 && g < 80) return i / FPS
  }
  throw new Error('no sync flash in the first 8 s of the capture')
}
const FLASH = flashTime()
const T = (name) => {
  const m = cap.markers.find((x) => x.name === name)
  if (!m) throw new Error(`no marker ${name}`)
  return m.t - cap.flash + FLASH
}
/** A marker's rect in capture pixels, grown by `pad` CSS px. */
const R = (name, pad = 0) => {
  const m = cap.markers.find((x) => x.name === name)
  if (!m?.rect) throw new Error(`no rect on ${name}`)
  const d = cap.view.dpr
  return { x: (m.rect.x - pad) * d, y: (m.rect.y - pad) * d, w: (m.rect.w + 2 * pad) * d, h: (m.rect.h + 2 * pad) * d }
}
console.log(`flash at ${FLASH.toFixed(3)} s; source ${SRC_W}x${SRC_H}`)

// ---- The edit ----------------------------------------------------------------------------------
//
// Cards are full-frame title moments. Shots play parts of the capture ([from, to, speed]); a shot
// marked `cont` continues in the same window as the one before (content crossfades, title swaps).
// Camera keys are in capture time: `rect` to frame (capture px), or `full` for the whole window.

const FULL = null
const askPanel = { x: 0, y: 0, w: 560, h: 560 }
const SHOTS_AND_CARDS = [
  { card: 'hook', dur: 2.9 },
  { card: 'brand', dur: 2.3 },
  {
    label: '01', kicker: 'Read', title: 'Turns like real paper.',
    parts: [[T('opened') - 1.3, T('toolbar') - 0.2, 1]],
    cam: [{ at: T('opened') - 1.3, rect: FULL }, { at: T('flip') + 2.6, rect: FULL },
      { at: T('toolbar'), rect: { x: 160, y: 40, w: 1600, h: 900 } }]
  },
  {
    cont: true, label: '02', kicker: 'Annotate', title: 'Highlight, underline, take notes.',
    parts: [[T('highlight') - 0.1, T('note') - 0.3, 1.35], [T('note'), T('ask') - 0.5, 1.6]],
    cam: [{ at: T('highlight') - 0.1, rect: { ...R('highlight', 40), y: 0 } }, { at: T('note') - 0.4, rect: { ...R('highlight', 40), y: 0 } },
      { at: T('note') + 0.4, rect: R('note', 30) }, { at: T('ask') - 0.5, rect: R('note', 30) }]
  },
  { card: 'ai', dur: 2.2 },
  {
    label: '03', kicker: 'Ask the book', title: 'Answers from your book. Every page cited.',
    parts: [[T('ask') - 0.2, T('ask-sent') + 0.4, 1.5], [T('ask-answered') - 0.3, T('who') - 0.3, 1]],
    cam: [{ at: T('ask') - 0.2, rect: FULL }, { at: T('ask-open'), rect: askPanel }, { at: T('ask-cite') - 0.2, rect: askPanel },
      { at: T('ask-cite') + 0.7, rect: FULL }]
  },
  {
    cont: true, label: '04', kicker: 'Who is this?', title: 'Who is this? Never past your page.',
    parts: [[T('who'), T('who-sent') + 0.3, 1.25], [T('who-answered') - 0.3, T('lookup') - 0.6, 1]],
    cam: [{ at: T('who'), rect: FULL }, { at: T('who-sent'), rect: FULL }, { at: T('who-answered') + 0.2, rect: askPanel },
      { at: T('lookup') - 1.4, rect: askPanel }, { at: T('lookup') - 0.6, rect: FULL }]
  },
  { card: 'rag', dur: 6.4 },
  {
    label: '05', kicker: 'Look it up', title: 'Look up any word without leaving the page.',
    parts: [[T('lookup') + 0.2, T('lookup-sent') + 0.2, 1.25], [T('lookup-ready') - 0.2, T('pen') - 0.6, 1]],
    cam: [{ at: T('lookup') + 0.2, rect: FULL }, { at: T('lookup-sent'), rect: { x: 980, y: 40, w: 720, h: 560 } },
      { at: T('pen'), rect: { x: 980, y: 40, w: 720, h: 560 } }]
  },
  {
    cont: true, label: '06', kicker: 'Write', title: 'A pen for the margins.',
    parts: [[T('pen') + 0.6, T('bookmark') - 0.4, 1.5]],
    cam: [{ at: T('pen'), rect: R('pen', 40) }, { at: T('bookmark'), rect: R('pen', 40) }]
  },
  {
    cont: true, label: '07', kicker: 'Themes', title: 'Light, sepia or dark.',
    parts: [[T('themes') + 0.2, T('zoom') - 0.1, 1.25]],
    cam: [{ at: T('themes'), rect: FULL }, { at: T('zoom'), rect: FULL }]
  },
  {
    cont: true, label: '08', kicker: 'Notebook', title: 'Every highlight and note in one place.',
    parts: [[T('notebook') - 0.1, T('notebook') + 1.6, 1]], hold: 2.4,
    cam: [{ at: T('notebook') - 0.1, rect: FULL }, { at: T('notebook') + 0.5, rect: { x: 0, y: 0, w: 900, h: 760 } }]
  },
  { card: 'outro', dur: 4.2 }
]

// ---- Frames of each shot ------------------------------------------------------------------------

/** Extracts every 60 fps frame of [from, to) to a folder; returns the files. */
function extract(from, to, dir) {
  mkdirSync(dir, { recursive: true })
  ff(['-ss', from.toFixed(3), '-i', CFR, '-t', (to - from).toFixed(3), '-vf', 'fps=60', '-q:v', '2', join(dir, '%05d.jpg')])
  return readdirSync(dir).sort().map((f) => join(dir, f))
}

/** One output frame list per shot: {a, b, mix, t} — two source frames blended, and capture time. */
function shotFrames(s, i) {
  const out = []
  s.parts.forEach(([from, to, speed], p) => {
    const files = extract(from, to, join(WORK, `shot${i}-${p}`))
    const n = Math.floor(files.length / speed)
    for (let j = 0; j < n; j++) {
      const pos = j * speed
      const k = Math.min(Math.floor(pos), files.length - 1)
      const k2 = Math.min(k + 1, files.length - 1)
      // Blend only when sped up (motion-blur-like); at 1x show the frame as is.
      const mix = speed > 1.01 ? pos - k : 0
      out.push({ a: pathToFileURL(files[k]).href, b: pathToFileURL(files[k2]).href, mix, t: from + pos / FPS })
    }
  })
  const last = out.at(-1)
  for (let h = 0; h < Math.round((s.hold ?? 0) * FPS); h++) out.push({ ...last, mix: 0 })
  return out
}

// ---- Camera ------------------------------------------------------------------------------------

const VW = 1600 // the app window on the stage
const VH = Math.round((VW * SRC_H) / SRC_W)
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** Zoom and focus point for a rect (null: the whole window). */
function view(rect) {
  if (!rect) return { z: 1, fx: SRC_W / 2, fy: SRC_H / 2 }
  const z = Math.max(1, Math.min(1.9, Math.min(SRC_W / rect.w, SRC_H / rect.h) * 0.94))
  return { z, fx: rect.x + rect.w / 2, fy: rect.y + rect.h / 2 }
}

/** Camera at capture time t: eased between keys; transform of the source inside the window. */
function camera(keys, t) {
  let v
  if (t <= keys[0].at) v = view(keys[0].rect)
  else if (t >= keys.at(-1).at) v = view(keys.at(-1).rect)
  else {
    const i = keys.findIndex((k) => k.at > t)
    const a = view(keys[i - 1].rect)
    const b = view(keys[i].rect)
    const k = ease((t - keys[i - 1].at) / (keys[i].at - keys[i - 1].at))
    // Interpolate zoom in log space so pushes feel even.
    v = { z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * k), fx: a.fx + (b.fx - a.fx) * k, fy: a.fy + (b.fy - a.fy) * k }
  }
  const s = (VW / SRC_W) * v.z
  const tx = Math.min(0, Math.max(VW - SRC_W * s, VW / 2 - v.fx * s))
  const ty = Math.min(0, Math.max(VH - SRC_H * s, VH / 2 - v.fy * s))
  return { s, tx, ty }
}

// ---- The stage page ----------------------------------------------------------------------------

const icon = readFileSync(join(here, '..', '..', 'src-tauri', 'icons', '128x128@2x.png')).toString('base64')
const STAGE = join(WORK, 'stage.html')
writeFileSync(STAGE, `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500&display=block" rel="stylesheet">
<style>
  :root { --canvas:#fafaf9; --ink:#171717; --soft:#6e6e76; --brand:#2f5fd8; --spark:#e0680a; }
  * { box-sizing:border-box }
  html,body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:var(--canvas); color:var(--ink);
    font-family:Geist,sans-serif; -webkit-font-smoothing:antialiased; letter-spacing:-.02em }
  .dots { position:absolute; inset:0; background-image:radial-gradient(rgba(23,23,23,.07) 1.2px, transparent 1.2px);
    background-size:28px 28px; mask-image:radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 100%) }
  .glow { position:absolute; left:50%; top:58%; width:1500px; height:700px; transform:translate(-50%,-50%);
    background:radial-gradient(closest-side, rgba(47,95,216,.13), transparent); filter:blur(10px) }
  #shot { position:absolute; inset:0 }
  #win { position:absolute; left:${(W - VW) / 2}px; top:${H - VH - 44}px; width:${VW}px; height:${VH}px; border-radius:16px; overflow:hidden;
    background:#7d8a9a; box-shadow:0 0 0 1px rgba(23,23,23,.08), 0 2px 6px rgba(23,23,23,.06), 0 40px 90px -24px rgba(23,23,23,.45);
    transform-origin:50% 60% }
  #win img { position:absolute; left:0; top:0; width:${SRC_W}px; height:${SRC_H}px; transform-origin:0 0 }
  .head { position:absolute; left:${(W - VW) / 2}px; right:${(W - VW) / 2}px; top:0; height:${H - VH - 44}px; display:flex; align-items:center;
    gap:22px }
  .head .num { font:500 20px 'Geist Mono',monospace; color:var(--spark); letter-spacing:0; padding:6px 12px; border:1.5px solid rgba(224,104,10,.35);
    border-radius:999px }
  .head .kicker { font:500 22px Geist; color:var(--soft); letter-spacing:-.01em }
  .head .title { font:600 50px/1 Geist; letter-spacing:-.035em; margin-left:auto }
  .w { display:inline-block; white-space:pre }
  .card { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center }
  .big { font:600 128px/1.0 Geist; letter-spacing:-.045em }
  .muted { color:rgba(23,23,23,.36) }
  .accent { color:var(--spark) }
  .pill { display:inline-flex; align-items:center; gap:12px; padding:10px 20px; border-radius:999px; font:500 22px Geist }
  .chip { padding:22px 30px; border-radius:20px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
    text-align:left; min-width:330px }
  .chip b { display:block; font:600 32px Geist; color:#fff; letter-spacing:-.02em }
  .chip span { display:block; margin-top:6px; font:400 20px Geist; color:rgba(255,255,255,.6); letter-spacing:-.005em }
  .stat { text-align:left; padding:0 44px; border-left:1px solid rgba(255,255,255,.14) }
  .stat:first-child { border-left:0 }
  .stat b { display:block; font:600 104px/1 Geist; letter-spacing:-.05em; color:#fff; font-variant-numeric:tabular-nums }
  .stat span { display:block; margin-top:12px; font:400 21px/1.35 Geist; color:rgba(255,255,255,.62); max-width:330px; letter-spacing:-.005em }
</style></head><body>
<div class="dots"></div><div class="glow"></div>
<div id="shot"><div class="head" id="head"></div><div class="head" id="head2"></div>
  <div id="win"><img id="a"><img id="b"><img id="c"></div></div>
<div id="card"></div>
<script>
const ICON = 'data:image/png;base64,${icon}'
const clamp = (x) => Math.max(0, Math.min(1, x))
const outCubic = (x) => 1 - Math.pow(1 - clamp(x), 3)
const outBack = (x) => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const inOut = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }

/** Word-by-word rise: blur, offset and fade out as each word lands. */
function words(text, t, { delay = 0, stagger = 0.06, dur = 0.55, cls = '' } = {}) {
  return text.split(/(\\s+)/).map((w, i) => {
    if (/^\\s+$/.test(w)) return w
    const k = outCubic((t - delay - (i / 2) * stagger) / dur)
    return '<span class="w ' + cls + '" style="opacity:' + k + ';transform:translateY(' + (1 - k) * 38 + 'px);filter:blur(' + (1 - k) * 8 + 'px)">' + w + '</span>'
  }).join('')
}
function fadeIn(t, d = 0, dur = 0.5, y = 24) {
  const k = outCubic((t - d) / dur)
  return 'opacity:' + k + ';transform:translateY(' + (1 - k) * y + 'px)'
}

const CARDS = {
  hook(t, dur) {
    return '<div class="card"><div class="big">' + words('Read with an AI', t, { delay: 0.15 }) + '</div>' +
      '<div class="big muted" style="margin-top:8px">' + words('that knows', t, { delay: 0.55 }) + ' ' +
      words('your book.', t, { delay: 0.75, cls: 'accent' }) + '</div></div>'
  },
  brand(t) {
    const k = outBack((t - 0.05) / 0.6)
    return '<div class="card"><div style="display:flex;align-items:center;gap:38px">' +
      '<img src="' + ICON + '" width="168" height="168" style="border-radius:40px;box-shadow:0 24px 60px -18px rgba(23,23,23,.45);transform:scale(' + (0.55 + 0.45 * k) + ') rotate(' + (1 - k) * -8 + 'deg);opacity:' + clamp(k * 1.4) + '">' +
      '<div style="text-align:left"><div style="font:600 136px/1 Geist;letter-spacing:-.05em;' + fadeIn(t, 0.25, 0.55, 0) + ';transform:translateX(' + (1 - outCubic((t - 0.25) / 0.55)) * -30 + 'px)">PageTurn</div>' +
      '<div style="margin-top:16px;font:400 32px Geist;color:var(--soft);' + fadeIn(t, 0.6, 0.5, 14) + '">The PDF reader for Windows with an AI that reads along.</div></div></div></div>'
  },
  ai(t) {
    const r = inOut(t / 0.55) * 1400
    return '<div class="card" style="background:var(--brand);color:#fff;clip-path:circle(' + r + 'px at 50% 50%)">' +
      '<div class="pill" style="background:rgba(255,255,255,.14);color:rgba(255,255,255,.9);' + fadeIn(t, 0.3) + '">Built on RAG</div>' +
      '<div class="big" style="margin-top:34px;font-size:120px">' + words('Now ask your book', t, { delay: 0.4 }) + '</div>' +
      '<div class="big" style="font-size:120px;color:rgba(255,255,255,.55)">' + words('anything.', t, { delay: 0.75 }) + '</div></div>'
  },
  rag(t) {
    const n = (to, d) => Math.round(to * outCubic((t - d) / 1.1))
    const arrow = (d) => '<div style="font:400 34px Geist;color:rgba(255,255,255,.35);' + fadeIn(t, d, 0.4, 0) + '">→</div>'
    return '<div class="card" style="background:#121212;color:#fff;opacity:' + clamp(t / 0.3) + '">' +
      '<div style="font:500 22px \\'Geist Mono\\',monospace;letter-spacing:.08em;color:var(--spark);' + fadeIn(t, 0.15) + '">UNDER THE HOOD</div>' +
      '<div style="margin-top:22px;font:600 92px/1 Geist;letter-spacing:-.045em">' + words('Vector RAG', t, { delay: 0.3 }) + ' <span style="color:rgba(255,255,255,.4)">' + words('+', t, { delay: 0.45 }) + '</span> ' + words('Graph RAG', t, { delay: 0.55 }) + '</div>' +
      '<div style="margin-top:56px;display:flex;align-items:center;gap:26px">' +
        '<div class="chip" style="' + fadeIn(t, 0.9) + '"><b>Vector search</b><span>Closest passages · Chroma</span></div>' + arrow(1.05) +
        '<div class="chip" style="' + fadeIn(t, 1.15) + '"><b>Knowledge graph</b><span>How terms relate · Neo4j</span></div>' + arrow(1.3) +
        '<div class="chip" style="' + fadeIn(t, 1.4) + ';border-color:rgba(224,104,10,.5)"><b>Cited answer</b><span>Only from your book, with pages</span></div>' +
      '</div>' +
      '<div style="margin-top:76px;display:flex">' +
        '<div class="stat" style="' + fadeIn(t, 2.0) + '"><b>' + n(80, 2.0) + '%</b><span>right page in the top 3 passages, across the whole book</span></div>' +
        '<div class="stat" style="' + fadeIn(t, 2.2) + '"><b style="color:#ffb470">' + n(87, 2.2) + '%</b><span>on questions about how ideas relate, vector + graph</span></div>' +
        '<div class="stat" style="' + fadeIn(t, 2.4) + '"><b>' + n(4, 2.4) + '/4</b><span>off-topic questions refused instead of made up</span></div>' +
      '</div>' +
      '<div style="margin-top:56px;font:400 20px Geist;color:rgba(255,255,255,.42);' + fadeIn(t, 3.0) + '">Measured on a hand-checked golden set · FastAPI · LangChain · gpt-oss-120b</div></div>'
  },
  outro(t) {
    const k = outBack((t - 0.05) / 0.6)
    return '<div class="card">' +
      '<img src="' + ICON + '" width="120" height="120" style="border-radius:28px;box-shadow:0 24px 60px -18px rgba(23,23,23,.45);transform:scale(' + (0.6 + 0.4 * k) + ');opacity:' + clamp(k * 1.4) + '">' +
      '<div class="big" style="margin-top:40px;font-size:104px">' + words('Read with an AI', t, { delay: 0.2 }) + '</div>' +
      '<div class="big muted" style="font-size:104px">' + words('that knows', t, { delay: 0.45 }) + ' ' + words('your book.', t, { delay: 0.6, cls: 'accent' }) + '</div>' +
      '<div style="margin-top:54px;display:flex;align-items:center;gap:18px;' + fadeIn(t, 1.0) + '">' +
        '<span class="pill" style="background:var(--brand);color:#fff;font:600 30px Geist;padding:20px 38px;box-shadow:0 14px 34px -12px rgba(47,95,216,.7)">Download free for Windows</span></div>' +
      '<div style="margin-top:26px;font:400 24px Geist;color:var(--soft);' + fadeIn(t, 1.25) + '">pageturn.vercel.app · Windows 10 and 11 · about 5 MB</div></div>'
  }
}

const $ = (id) => document.getElementById(id)
function head(el, s, t, out) {
  if (!s) { el.innerHTML = ''; return }
  const k = out ? 1 - outCubic(t / 0.3) : 1
  el.style.opacity = k
  el.style.transform = out ? 'translateY(' + (1 - k) * -22 + 'px)' : ''
  el.innerHTML = '<span class="num" style="' + (out ? '' : fadeIn(t, 0, 0.4, 10)) + '">' + s.label + '</span>' +
    '<span class="kicker" style="' + (out ? '' : fadeIn(t, 0.08, 0.4, 10)) + '">' + s.kicker + '</span>' +
    '<span class="title">' + (out ? s.title : words(s.title, t, { delay: 0.12, stagger: 0.05, dur: 0.5 })) + '</span>'
}
async function load(img, src) {
  if (img.getAttribute('src') !== src) { img.src = src; await img.decode().catch(() => {}) }
}

window.draw = async (f) => {
  $('card').innerHTML = f.card ? CARDS[f.card.name](f.card.t, f.card.dur) : ''
  $('card').style.opacity = f.card ? f.card.alpha : 0
  $('shot').style.display = f.shot ? '' : 'none'
  if (!f.shot) return
  const s = f.shot
  await Promise.all([load($('a'), s.a), load($('b'), s.b), load($('c'), s.prev ?? s.a)])
  const tf = 'translate(' + s.cam.tx + 'px,' + s.cam.ty + 'px) scale(' + s.cam.s + ')'
  $('a').style.transform = $('b').style.transform = tf
  $('b').style.opacity = s.mix
  $('c').style.transform = s.prevCam ? 'translate(' + s.prevCam.tx + 'px,' + s.prevCam.ty + 'px) scale(' + s.prevCam.s + ')' : tf
  $('c').style.opacity = s.prev ? s.prevAlpha : 0
  const e = outCubic(s.enter), x = s.exit
  $('win').style.opacity = e * (1 - x)
  $('win').style.transform = 'translateY(' + ((1 - e) * 70 + x * 20) + 'px) scale(' + (0.94 + 0.06 * e - 0.02 * x) + ')'
  head($('head'), s.head, s.headT, false)
  $('head').style.opacity = 1 - x
  head($('head2'), s.prevHead, s.headT, true)
}
</script></body></html>`)

// ---- Render ------------------------------------------------------------------------------------

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(pathToFileURL(STAGE).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

const DEMO = join(SITE, 'demo.mp4')
const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg',
  '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', DEMO],
  { stdio: ['pipe', 'inherit', 'inherit'] })
const encDone = new Promise((r) => enc.on('exit', r))
async function emit(state) {
  await page.evaluate((f) => window.draw(f), state)
  const jpg = await page.screenshot({ type: 'jpeg', quality: 94 })
  if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r))
}

const ENTER = 0.6
const EXIT = 0.3
let outT = 0
const starts = {}
let prevShot = null // last frame of the previous shot, for crossfades
for (let i = 0; i < SHOTS_AND_CARDS.length; i++) {
  const seg = SHOTS_AND_CARDS[i]
  const next = SHOTS_AND_CARDS[i + 1]
  if (seg.card) {
    starts[seg.card] = outT
    const n = Math.round(seg.dur * FPS)
    for (let j = 0; j < n; j++) {
      const t = j / FPS
      // Cards fade out at the end (the last one holds, so the loop restarts on it).
      const alpha = next ? Math.min(1, (seg.dur - t) / 0.28) : 1
      await emit({ card: { name: seg.card, t, dur: seg.dur, alpha } })
    }
    prevShot = null
    outT += seg.dur
    console.log(`card ${seg.card}  ${seg.dur.toFixed(1)}s`)
    continue
  }
  starts[seg.kicker] = outT
  const frames = shotFrames(seg, i)
  const exits = !next?.cont
  const XF = 0.3 // crossfade from the previous shot in the same window
  for (let j = 0; j < frames.length; j++) {
    const f = frames[j]
    const t = j / FPS
    const left = (frames.length - j) / FPS
    const shot = {
      a: f.a, b: f.b, mix: f.mix, cam: camera(seg.cam, f.t),
      enter: seg.cont ? 1 : t / ENTER,
      exit: exits ? Math.max(0, 1 - left / EXIT) : 0,
      head: seg, headT: t,
      prevHead: seg.cont && prevShot && t < 0.3 ? prevShot.head : null
    }
    if (seg.cont && prevShot && t < XF) Object.assign(shot, { prev: prevShot.a, prevCam: prevShot.cam, prevAlpha: 1 - t / XF })
    await emit({ shot })
    if (j === frames.length - 1) prevShot = { a: f.a, cam: shot.cam, head: seg }
  }
  outT += frames.length / FPS
  console.log(`shot ${seg.label} ${seg.kicker}  ${(frames.length / FPS).toFixed(1)}s`)
}
enc.stdin.end()
await encDone
await browser.close()
console.log(`demo.mp4  ${outT.toFixed(1)}s`)

// Poster: the cited answer, zoomed in.
ff(['-ss', (starts['Ask the book'] + 4.2).toFixed(2), '-i', DEMO, '-frames:v', '1', '-q:v', '3', join(SITE, 'poster.jpg')])

// ---- Feature tiles: 4:3 loops cropped from the source (crop in capture px) ---------------------

const CLIPS = [
  { name: 'highlight', parts: [[T('highlight') - 0.1, T('note') - 0.6]], crop: [200, 0, 960, 720] },
  { name: 'ask', parts: [[T('ask'), T('ask-sent') + 0.5], [T('ask-answered') - 0.2, T('ask-cite') + 1.4]], hold: 1.0, crop: [0, 0, 960, 720] },
  { name: 'who', parts: [[T('who-sent') - 0.2, T('who-sent') + 0.5], [T('who-answered') - 0.2, T('lookup') - 0.8]], hold: 0.8, crop: [0, 0, 960, 720] },
  { name: 'lookup', parts: [[T('lookup') + 0.2, T('lookup-sent') + 0.4], [T('lookup-ready') - 0.2, T('pen') - 0.6]], crop: [900, 0, 960, 720] }
]
for (const c of CLIPS) {
  const [x, y, w, h] = c.crop
  const list = join(WORK, `clip-${c.name}.txt`)
  const pieces = c.parts.map(([a, b], i) => {
    const f = join(WORK, `clip-${c.name}-${i}.mp4`)
    ff(['-ss', a.toFixed(3), '-i', CFR, '-t', (b - a).toFixed(3), '-vf', `fps=60,crop=${w}:${h}:${x}:${y},scale=800:600:flags=lanczos,format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', f])
    return f
  })
  writeFileSync(list, pieces.map((p) => `file '${p.replaceAll('\\', '/')}'`).join('\n') + '\n')
  const mp4 = join(SITE, 'clips', `${c.name}.mp4`)
  const holdF = c.hold ? `,tpad=stop_mode=clone:stop_duration=${c.hold}` : ''
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=60${holdF}`, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
  ff(['-sseof', '-0.3', '-i', mp4, '-frames:v', '1', '-q:v', '4', join(SITE, 'clips', `${c.name}.jpg`)])
  console.log(`clip ${c.name}`)
}
