import { describe, it, expect } from 'vitest'
import {
  BookIdSchema,
  HighlightSchema,
  InkStrokeSchema,
  PageSchema,
  PathsSchema,
  SettingsPartialSchema
} from '@shared/ipc'

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

  const uuid = '123e4567-e89b-42d3-a456-426614174000'
  const stroke = {
    id: uuid,
    bookId: 'a'.repeat(64),
    page: 1,
    points: [
      [0.1, 0.2, 0.5],
      [0.3, 0.4, 0.6]
    ],
    color: '#1f1f1f',
    width: 0.005,
    tool: 'pen',
    createdAt: 1
  }

  it('InkStrokeSchema rejects NaN and points outside [-0.05, 1.05]', () => {
    expect(InkStrokeSchema.safeParse(stroke).success).toBe(true)
    expect(InkStrokeSchema.safeParse({ ...stroke, points: [[NaN, 0.2, 0.5]] }).success).toBe(false)
    expect(InkStrokeSchema.safeParse({ ...stroke, points: [[1.2, 0.2, 0.5]] }).success).toBe(false)
    expect(InkStrokeSchema.safeParse({ ...stroke, points: [[0.2, 0.2, 1.5]] }).success).toBe(false)
  })

  it('HighlightSchema rejects colours outside the palette', () => {
    const h = {
      id: uuid,
      bookId: 'a'.repeat(64),
      page: 2,
      rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }],
      text: 'Lorem',
      color: 'yellow',
      style: 'highlight',
      noteId: null,
      createdAt: 1,
      updatedAt: 1
    }
    expect(HighlightSchema.safeParse(h).success).toBe(true)
    expect(HighlightSchema.safeParse({ ...h, color: 'red' }).success).toBe(false)
    expect(HighlightSchema.safeParse({ ...h, style: 'wavy' }).success).toBe(true)
    expect(HighlightSchema.safeParse({ ...h, style: 'strike' }).success).toBe(false)
  })

  it('SettingsPartialSchema only accepts the three pen widths and six ink colours', () => {
    expect(SettingsPartialSchema.safeParse({ penWidth: 0.005 }).success).toBe(true)
    expect(SettingsPartialSchema.safeParse({ penWidth: 0.003 }).success).toBe(false)
    expect(SettingsPartialSchema.safeParse({ penColor: '#d0342c' }).success).toBe(true)
    expect(SettingsPartialSchema.safeParse({ penColor: '#000000' }).success).toBe(false)
    expect(
      SettingsPartialSchema.safeParse({ drawWithMouse: true, highlightColor: 'pink' }).success
    ).toBe(true)
  })
})
