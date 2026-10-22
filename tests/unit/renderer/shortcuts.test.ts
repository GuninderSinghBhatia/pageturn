// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { installShortcuts, isTypingTarget, normalizeKey } from '@renderer/app/shortcuts'

let off: (() => void) | null = null
afterEach(() => {
  off?.()
  off = null
  document.body.innerHTML = ''
})

const key = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

describe('normalizeKey', () => {
  it('orders modifiers Ctrl, Alt, Shift and lower-cases letters', () => {
    expect(
      normalizeKey(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true }))
    ).toBe('Ctrl+Shift+g')
    expect(normalizeKey(new KeyboardEvent('keydown', { key: 'p' }))).toBe('p')
    expect(normalizeKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe('ArrowRight')
    expect(normalizeKey(new KeyboardEvent('keydown', { key: 'b', metaKey: true }))).toBe('Ctrl+b')
    expect(normalizeKey(new KeyboardEvent('keydown', { key: ' ' }))).toBe('Space')
  })
})

describe('isTypingTarget', () => {
  it('knows text fields', () => {
    const ta = document.createElement('textarea')
    const div = document.createElement('div')
    div.contentEditable = 'true'
    expect(isTypingTarget(ta)).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('installShortcuts', () => {
  it('single letters do nothing while typing a note; Ctrl+B and Esc still work', () => {
    const pen = vi.fn()
    const notebook = vi.fn()
    const esc = vi.fn()
    off = installShortcuts({ p: pen, 'Ctrl+b': notebook, Escape: esc })
    const ta = document.body.appendChild(document.createElement('textarea'))
    key({ key: 'p' }, ta)
    expect(pen).not.toHaveBeenCalled()
    key({ key: 'b', ctrlKey: true }, ta)
    expect(notebook).toHaveBeenCalledTimes(1)
    key({ key: 'Escape' }, ta)
    expect(esc).toHaveBeenCalledTimes(1)
    key({ key: 'p' })
    expect(pen).toHaveBeenCalledTimes(1)
  })

  it('text-editing shortcuts (Ctrl+Z) stay with the text field', () => {
    const undo = vi.fn()
    off = installShortcuts({ 'Ctrl+z': undo })
    const ta = document.body.appendChild(document.createElement('textarea'))
    key({ key: 'z', ctrlKey: true }, ta)
    expect(undo).not.toHaveBeenCalled()
    key({ key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('a handled key is prevented; a handler returning false lets it through', () => {
    off = installShortcuts({ h: () => false, t: () => {} })
    expect(key({ key: 'h' }).defaultPrevented).toBe(false)
    expect(key({ key: 't' }).defaultPrevented).toBe(true)
    expect(key({ key: 'q' }).defaultPrevented).toBe(false)
  })

  it('can be switched off while something else owns the keyboard', () => {
    const fn = vi.fn()
    let enabled = false
    off = installShortcuts({ p: fn }, () => enabled)
    key({ key: 'p' })
    enabled = true
    key({ key: 'p' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
