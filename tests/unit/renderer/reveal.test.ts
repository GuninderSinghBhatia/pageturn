import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToolbarReveal } from '@renderer/reader/chrome/reveal'

let changes: boolean[]
let r: ToolbarReveal

beforeEach(() => {
  vi.useFakeTimers()
  changes = []
  r = new ToolbarReveal((v) => changes.push(v))
})
afterEach(() => vi.useRealTimers())

describe('ToolbarReveal', () => {
  it('shows when the pointer enters the top 40px', () => {
    r.pointer(300, false)
    expect(r.visible).toBe(false)
    r.pointer(40, false)
    expect(r.visible).toBe(true)
    expect(changes).toEqual([true])
  })

  it('hides 800ms after the pointer leaves the zone and the toolbar', () => {
    r.pointer(10, false)
    r.pointer(300, false)
    vi.advanceTimersByTime(799)
    expect(r.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(r.visible).toBe(false)
  })

  it('stays while the pointer is over the toolbar (even below the zone)', () => {
    r.pointer(10, false)
    r.pointer(70, true)
    vi.advanceTimersByTime(2000)
    expect(r.visible).toBe(true)
  })

  it('coming back before 800ms cancels the hide', () => {
    r.pointer(10, false)
    r.pointer(300, false)
    vi.advanceTimersByTime(500)
    r.pointer(20, false)
    vi.advanceTimersByTime(1000)
    expect(r.visible).toBe(true)
  })

  it('T toggles and a toggled-open toolbar does not auto-hide', () => {
    r.toggle()
    expect(r.visible).toBe(true)
    r.pointer(500, false)
    vi.advanceTimersByTime(2000)
    expect(r.visible).toBe(true)
    r.toggle()
    expect(r.visible).toBe(false)
  })

  it('a pinned toolbar (tool active) stays and survives idle', () => {
    r.setPinned(true)
    expect(r.visible).toBe(true)
    r.pointer(500, false)
    vi.advanceTimersByTime(2000)
    r.idle()
    expect(r.visible).toBe(true)
    r.setPinned(false)
    r.pointer(500, false)
    vi.advanceTimersByTime(800)
    expect(r.visible).toBe(false)
  })

  it('T does not hide a pinned toolbar (a tool is active)', () => {
    r.setPinned(true)
    r.toggle()
    expect(r.visible).toBe(true)
  })

  it('idle hides an unpinned toolbar, but not while it has keyboard focus', () => {
    r.toggle()
    r.setFocused(true)
    r.idle()
    expect(r.visible).toBe(true)
    r.setFocused(false)
    r.idle()
    expect(r.visible).toBe(false)
  })

  it('hide() closes it immediately (Esc)', () => {
    r.toggle()
    r.hide()
    expect(r.visible).toBe(false)
    expect(changes).toEqual([true, false])
  })
})
