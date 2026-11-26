// Typesets chapters I–IV of Alice's Adventures in Wonderland (public domain, Project Gutenberg #11)
// into a 5.5 × 8.5 in paperback PDF for the demo video.
//
//   node scripts/demo-video/make-book.mjs   →  scripts/demo-video/out/alice.pdf
import { chromium } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const out = join(here, 'out')
mkdirSync(out, { recursive: true })

const raw = readFileSync(join(here, 'alice.txt'), 'utf8').replace(/\r\n/g, '\n')
const body = raw.slice(raw.indexOf('CHAPTER I.'), raw.indexOf('CHAPTER V.'))
const chapters = body
  .split(/^CHAPTER /m)
  .filter(Boolean)
  .map((c) => {
    const [head, ...rest] = c.split('\n')
    const [num, ...title] = head.replace(/\.$/, '').split('. ')
    const paras = rest
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
    return { num, title: title.join('. '), paras }
  })

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
// Straight quotes → curly; SHOUTED WORDS → small caps (Carroll's emphasis), _x_ → italic.
const typeset = (s) =>
  esc(s)
    .replace(/--/g, '—')
    .replace(/'(?=[\s,.;:!?)]|$)/g, '’')
    .replace(/(^|[\s(—-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s(—-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
    .replace(/\b([A-Z]{2,}(?:[ -][A-Z]{2,})*)\b/g, (m) =>
      /^(I|II|III|IV|V)$/.test(m) ? m : `<span class="sc">${m.toLowerCase()}</span>`
    )

const poemLike = (p) => p.length < 60 && !/[.?!’”]$/.test(p)

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=block" rel="stylesheet">
<style>
@page { size: 5.5in 8.5in; margin: 0.8in 0.7in 0.85in; }
@page cover { margin: 0; }
html { font-family: 'EB Garamond', serif; font-size: 11.5pt; line-height: 1.42; color: #1d1a16;
  font-variant-numeric: oldstyle-nums; hyphens: auto; }
body { margin: 0; }
.cover { page: cover; height: 8.5in; background: #1f3a33; color: #f3ead7; display: flex;
  flex-direction: column; align-items: center; justify-content: center; text-align: center; break-after: page; }
.cover .rule { width: 1.1in; border-top: 1px solid #c9a95c; margin: 0.28in 0; }
.cover h1 { font-weight: 400; font-size: 30pt; line-height: 1.1; margin: 0; letter-spacing: 0.01em; }
.cover .by { font-size: 12pt; letter-spacing: 0.24em; text-transform: uppercase; color: #c9a95c; }
.cover .ill { font-style: italic; font-size: 11pt; opacity: 0.8; margin-top: 1.4in; }
.title { break-after: page; text-align: center; padding-top: 2.2in; }
.title h1 { font-weight: 400; font-size: 21pt; margin: 0 0 0.2in; }
.title p { font-style: italic; margin: 0; }
.chapter { break-before: page; }
.chapter header { text-align: center; padding-top: 0.9in; margin-bottom: 0.45in; }
.chapter .num { font-size: 10pt; letter-spacing: 0.3em; color: #8a6d3b; }
.chapter h2 { font-weight: 400; font-style: italic; font-size: 17pt; margin: 0.12in 0 0; }
p { margin: 0; text-align: justify; text-indent: 1.4em; orphans: 2; widows: 2; }
header + p { text-indent: 0; }
header + p::first-letter { float: left; font-size: 3.6em; line-height: 0.82; padding: 0.06em 0.06em 0 0; color: #1f3a33; }
p.verse { text-align: left; text-indent: 0; padding-left: 2.4em; font-style: italic; }
.sc { font-variant: small-caps; letter-spacing: 0.04em; }
</style></head><body>
<section class="cover">
  <div class="by">Lewis Carroll</div><div class="rule"></div>
  <h1>Alice’s<br>Adventures in<br>Wonderland</h1><div class="rule"></div>
  <div class="ill">Chapters I – IV</div>
</section>
<section class="title"><h1>Alice’s Adventures in Wonderland</h1><p>by Lewis Carroll</p></section>
${chapters
  .map(
    (c) => `<section class="chapter"><header><div class="num">CHAPTER ${c.num}</div><h2>${esc(
      c.title
    )}</h2></header>
${c.paras.map((p) => `<p${poemLike(p) ? ' class="verse"' : ''}>${typeset(p)}</p>`).join('\n')}</section>`
  )
  .join('\n')}
</body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
// Cover without a page number, then the rest numbered (the footer can't skip page 1).
const cover = await page.pdf({ preferCSSPageSize: true, printBackground: true, pageRanges: '1' })
const rest = await page.pdf({
  preferCSSPageSize: true,
  printBackground: true,
  pageRanges: '2-',
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;text-align:center;font-family:Georgia,serif;font-size:8pt;color:#8a7f70;padding-bottom:0.3in"><span class="pageNumber"></span></div>`
})
await browser.close()
const doc = await PDFDocument.create()
doc.setTitle("Alice's Adventures in Wonderland")
doc.setAuthor('Lewis Carroll')
for (const bytes of [cover, rest]) {
  const src = await PDFDocument.load(bytes)
  for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg)
}
writeFileSync(join(out, 'alice.pdf'), await doc.save())
console.log('wrote', join(out, 'alice.pdf'), doc.getPageCount(), 'pages', chapters.map((c) => c.title))
