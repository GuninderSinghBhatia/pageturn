import { describe, it, expect } from 'vitest'
import { BookIdSchema, PageSchema, SettingsPartialSchema, PathsSchema } from '@shared/ipc'

describe('IPC schemas', () => {
  it('BookIdSchema accepts only 64 hex chars', () => {
    expect(BookIdSchema.safeParse('abc').success).toBe(false)
    expect(BookIdSchema.safeParse('a'.repeat(63) + 'f').success).toBe(true)
    expect(BookIdSchema.safeParse('0123456789abcdef'.repeat(4)).success).toBe(true)
  })

  it('PageSchema rejects 0 and non-integers', () => {
    expect(PageSchema.safeParse(0).success).toBe(false)
    expect(PageSchema.safeParse(1.5).success).toBe(false)
    expect(PageSchema.safeParse(1).success).toBe(true)
  })

  it('SettingsPartialSchema rejects unknown paper tints', () => {
    expect(SettingsPartialSchema.safeParse({ paperTint: 'neon' }).success).toBe(false)
    expect(SettingsPartialSchema.safeParse({ paperTint: 'sepia' }).success).toBe(true)
    expect(SettingsPartialSchema.safeParse({}).success).toBe(true)
  })

  it('PathsSchema requires a non-empty list of .pdf paths (case-insensitive)', () => {
    expect(PathsSchema.safeParse(['a.txt']).success).toBe(false)
    expect(PathsSchema.safeParse([]).success).toBe(false)
    expect(PathsSchema.safeParse(['C:\\x\\B.PDF']).success).toBe(true)
  })
})
