/*
 * Renders build/icon.svg into every app icon:
 *   resources/icon.png (window icon), build/icon.png, build/icon.ico (Windows), build/icon.icns (macOS)
 *   and src/renderer/public/favicon.svg (page favicon)
 * Run with: npm run icons   (uses Electron's Chromium to rasterise the SVG)
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { copyFileSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const BASE = 1024

/** ICO with PNG-compressed entries (Windows Vista and later). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt16LE(1, o + 4) // colour planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

/** ICNS with PNG entries. */
function icns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: BASE,
    height: BASE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 }
  })
  const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  // Whole page, then scaled to BASE (display scaling can make the capture larger or smaller).
  let image = await win.webContents.capturePage()
  const { width, height } = image.getSize()
  const side = Math.min(width, height)
  image = image
    .crop({
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    })
    .resize({ width: BASE, height: BASE, quality: 'best' })
  const png = (size) =>
    size === BASE
      ? image.toPNG()
      : image.resize({ width: size, height: size, quality: 'best' }).toPNG()

  copyFileSync(
    join(root, 'build', 'icon.svg'),
    join(root, 'src', 'renderer', 'public', 'favicon.svg')
  )
  writeFileSync(join(root, 'resources', 'icon.png'), png(512))
  writeFileSync(join(root, 'build', 'icon.png'), png(1024))
  writeFileSync(
    join(root, 'build', 'icon.ico'),
    ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size) })))
  )
  writeFileSync(
    join(root, 'build', 'icon.icns'),
    icns([
      { type: 'ic07', data: png(128) },
      { type: 'ic08', data: png(256) },
      { type: 'ic09', data: png(512) },
      { type: 'ic10', data: png(1024) }
    ])
  )
  console.log('icons written', nativeImage.createFromBuffer(png(64)).getSize())
  app.quit()
})
