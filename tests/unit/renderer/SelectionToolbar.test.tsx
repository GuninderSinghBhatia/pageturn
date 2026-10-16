// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SelectionToolbar } from '@renderer/reader/annotations/SelectionToolbar'

afterEach(cleanup)

const anchor = { left: 100, top: 200, width: 50, height: 12, right: 150, bottom: 212 }

describe('SelectionToolbar', () => {
  it('clicking a swatch highlights in that colour', () => {
    const onHighlight = vi.fn()
    render(
      <SelectionToolbar
        anchor={anchor}
        current="yellow"
        onHighlight={onHighlight}
        onCopy={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'green' }))
    expect(onHighlight).toHaveBeenCalledWith('green')
  })

  it('marks the last-used colour as pressed', () => {
    render(
      <SelectionToolbar anchor={anchor} current="pink" onHighlight={vi.fn()} onCopy={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'pink' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'blue' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('Copy calls onCopy', () => {
    const onCopy = vi.fn()
    render(
      <SelectionToolbar anchor={anchor} current="yellow" onHighlight={vi.fn()} onCopy={onCopy} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopy).toHaveBeenCalledOnce()
  })
})
