import { describe, it, expect } from 'vitest'
import { progressText } from '@renderer/ask/indexProgress'

describe('progressText (Ask drawer while a book is indexed)', () => {
  it('says the book is waiting while another book goes first', () => {
    expect(progressText('queued', undefined, 0)).toMatch(/another book is being indexed first/)
  })

  it('names the one-time model download, with its percentage', () => {
    expect(progressText('indexing', 'download', 42)).toBe(
      'Downloading the Ask model (one time, about 90 MB)… 42%'
    )
  })

  it('shows reading without a percentage (page count is not known yet)', () => {
    expect(progressText('indexing', 'read', 0)).toBe('Reading this book for Ask…')
  })

  it('shows embedding progress, also for rag-service, which sends no step', () => {
    expect(progressText('indexing', 'embed', 7)).toBe('Indexing this book for Ask… 7%')
    expect(progressText('indexing', undefined, 7)).toBe('Indexing this book for Ask… 7%')
  })
})
