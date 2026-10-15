import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Node can't run the browser build; swap in pdf.js's legacy build for these tests.
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'))

import { GlobalWorkerOptions } from 'pdfjs-dist'
import { openPdf, PasswordCancelledError } from '@renderer/reader/pdf/pdfService'

const FIX = join(__dirname, '..', '..', 'fixtures')
const load = (name: string): ArrayBuffer => {
  const b = readFileSync(join(FIX, name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const noPassword = { onPassword: async (): Promise<string | null> => null }

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'node_modules',
      'pdfjs-dist',
      'legacy',
      'build',
      'pdf.worker.mjs'
    )
  ).href
})

describe('openPdf', () => {
  it('opens text-500 with page count, metadata and text', async () => {
    const doc = await openPdf(load('text-500.pdf'), noPassword)
    expect(doc.numPages).toBe(500)
    expect(doc.metadata).toEqual({ title: 'Text 500', author: 'PageTurn Fixtures' })
    expect(await doc.hasText(1)).toBe(true)
    expect((await doc.getText(250)).some((t) => t.str.includes('Page 250'))).toBe(true)
    expect(doc.pageSize(1)).toEqual({ width: 432, height: 648 })
    doc.destroy()
  })

  it('reports no text on a scanned page', async () => {
    const doc = await openPdf(load('scanned.pdf'), noPassword)
    expect(await doc.hasText(1)).toBe(false)
    doc.destroy()
  })

  it('re-prompts after a wrong password, then opens', async () => {
    const answers = ['wrong', 'test']
    const onPassword = vi.fn(async () => answers.shift() ?? null)
    const doc = await openPdf(load('password.pdf'), { onPassword })
    expect(doc.numPages).toBe(1)
    expect(onPassword).toHaveBeenCalledTimes(2)
    expect(onPassword).toHaveBeenNthCalledWith(1, false)
    expect(onPassword).toHaveBeenNthCalledWith(2, true)
    doc.destroy()
  })

  it('rejects with PasswordCancelledError when the prompt is cancelled', async () => {
    await expect(openPdf(load('password.pdf'), noPassword)).rejects.toBeInstanceOf(
      PasswordCancelledError
    )
  })
})
