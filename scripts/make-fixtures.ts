// Generates the PDF fixtures used by unit and e2e tests. Run: npm run fixtures
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import PDFKit from 'pdfkit'

const OUT = join(__dirname, '..', 'tests', 'fixtures')
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco ' +
  'laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in ' +
  'voluptate velit esse cillum dolore eu fugiat nulla pariatur.'

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

async function textPdf(numPages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Text ${numPages}`)
  doc.setAuthor('PageTurn Fixtures')
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  for (let n = 1; n <= numPages; n++) {
    const page = doc.addPage([432, 648]) // 6x9 in
    page.drawText(`Page ${n}`, { x: 48, y: 590, size: 20, font: bold })
    let y = 556
    for (let p = 0; p < 4; p++) {
      for (const line of wrap(LOREM, 70)) {
        page.drawText(line, { x: 48, y, size: 11, font })
        y -= 15
      }
      y -= 12
    }
  }
  return doc.save()
}

/** Help panel e2e: like text-N, but page 4 starts with a line that makes the mock AI fail. */
async function helpPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Help Fixture')
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  for (let n = 1; n <= 6; n++) {
    const page = doc.addPage([432, 648])
    page.drawText(`Page ${n}`, { x: 48, y: 590, size: 20, font })
    let y = 556
    if (n === 4) {
      page.drawText('__FAIL_RATE__ this line makes the mock AI fail.', { x: 48, y, size: 11, font })
      y -= 27
    }
    for (const line of wrap(LOREM, 70)) {
      page.drawText(line, { x: 48, y, size: 11, font })
      y -= 15
    }
  }
  return doc.save()
}

async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const png = await doc.embedPng(readFileSync(join(__dirname, '..', 'resources', 'icon.png')))
  const page = doc.addPage([432, 648])
  page.drawImage(png, { x: 66, y: 174, width: 300, height: 300 })
  return doc.save()
}

function passwordPdf(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: [432, 648], userPassword: 'test', pdfVersion: '1.7' })
    const stream = createWriteStream(file)
    stream.on('finish', resolve).on('error', reject)
    doc.pipe(stream)
    doc.fontSize(20).text('Page 1', 48, 48)
    doc.fontSize(11).moveDown().text(LOREM)
    doc.end()
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  // `npm run fixtures -- help` writes just one fixture (keeps the others byte-stable).
  if (process.argv.includes('help')) {
    writeFileSync(join(OUT, 'help.pdf'), await helpPdf())
    return
  }
  writeFileSync(join(OUT, 'help.pdf'), await helpPdf())
  writeFileSync(join(OUT, 'text-500.pdf'), await textPdf(500))
  writeFileSync(join(OUT, 'text-1000.pdf'), await textPdf(1000))
  writeFileSync(join(OUT, 'one-page.pdf'), await textPdf(1))
  writeFileSync(join(OUT, 'odd-3.pdf'), await textPdf(3))
  writeFileSync(join(OUT, 'scanned.pdf'), await scannedPdf())
  await passwordPdf(join(OUT, 'password.pdf'))
  console.log(`Fixtures written to ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
