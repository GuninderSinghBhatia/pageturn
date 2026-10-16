import { describe, it, expect } from 'vitest'
import { inkAction, type InkMode } from '@renderer/reader/ink/inkInput'

const mode = (over: Partial<InkMode> = {}): InkMode => ({
  active: true,
  tool: 'pen',
  color: '#1f1f1f',
  width: 0.005,
  ...over
})
const pen = { pointerType: 'pen', buttons: 1, button: 0 }
const mouse = { pointerType: 'mouse', buttons: 1, button: 0 }
const touch = { pointerType: 'touch', buttons: 1, button: 0 }

describe('inkAction', () => {
  it('passes everything through when pen mode is off', () => {
    expect(inkAction(pen, mode({ active: false }), true)).toBe('pass')
  })

  it('a pen draws', () => {
    expect(inkAction(pen, mode(), false)).toBe('draw')
    expect(inkAction(pen, mode({ tool: 'highlighter' }), false)).toBe('draw')
  })

  it("the pen's eraser end erases (buttons bit 32 or button 5)", () => {
    expect(inkAction({ pointerType: 'pen', buttons: 32, button: 5 }, mode(), false)).toBe('erase')
    expect(inkAction({ pointerType: 'pen', buttons: 32, button: 0 }, mode(), false)).toBe('erase')
  })

  it('the eraser tool erases', () => {
    expect(inkAction(pen, mode({ tool: 'eraser' }), false)).toBe('erase')
    expect(inkAction(mouse, mode({ tool: 'eraser' }), true)).toBe('erase')
    expect(inkAction(mouse, mode({ tool: 'eraser' }), false)).toBe('erase') // chosen explicitly
  })

  it('touch always pans/turns', () => {
    expect(inkAction(touch, mode(), true)).toBe('pass')
  })

  it('the mouse draws only with "Draw with mouse" on, and only with the main button', () => {
    expect(inkAction(mouse, mode(), false)).toBe('pass')
    expect(inkAction(mouse, mode(), true)).toBe('draw')
    expect(inkAction({ pointerType: 'mouse', buttons: 2, button: 2 }, mode(), true)).toBe('pass')
  })
})
