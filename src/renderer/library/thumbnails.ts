import type { Book } from '@shared/types'
import { openPdf } from '../reader/pdf/pdfService'

const THUMB_WIDTH = 300

/** Renders page 1 at 300 px wide, stores it as the cover, and records title/author/page count. */
export async function generateThumbnail(book: Book): Promise<void> {
  const data = await window.api.library.getFile(book.id)
  // Password-protected books get no cover until opened; never prompt from the library.
  const doc = await openPdf(data, { onPassword: async () => null })
  try {
    const size = doc.pageSize(1)
    const bmp = await doc.renderPage(1, THUMB_WIDTH / size.width)
    const canvas = new OffscreenCanvas(
      THUMB_WIDTH,
      Math.round((bmp.height * THUMB_WIDTH) / bmp.width)
    )
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    await window.api.library.saveThumbnail(book.id, png)
    await window.api.library.updateMeta(book.id, {
      title: doc.metadata.title,
      author: doc.metadata.author,
      numPages: doc.numPages
    })
  } finally {
    doc.destroy()
  }
}
