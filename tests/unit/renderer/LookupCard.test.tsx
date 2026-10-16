// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/types'
import { LookupCard } from '@renderer/reader/annotations/LookupCard'
import { useNav } from '@renderer/app/nav'
import { useSettingsStore } from '@renderer/stores/settingsStore'

let wikipedia: ReturnType<typeof vi.fn>
let open: ReturnType<typeof vi.fn>

beforeEach(() => {
  wikipedia = vi.fn()
  open = vi.fn().mockResolvedValue(undefined)
  window.api = { lookup: { wikipedia, open } } as unknown as typeof window.api
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  useNav.setState({ settingsOpen: false })
})
afterEach(cleanup)

const card = { text: 'photosynthesis', x: 100, y: 100 }

describe('LookupCard', () => {
  it('shows the Wikipedia summary; Read on Wikipedia opens the article in the chosen place', async () => {
    wikipedia.mockResolvedValue({
      title: 'Photosynthesis',
      description: 'Biological process',
      extract: 'Photosynthesis is a process used by plants.',
      thumbnail: 'data:image/png;base64,AA==',
      url: 'https://en.wikipedia.org/wiki/Photosynthesis'
    })
    render(<LookupCard card={card} />)
    const dialog = screen.getByRole('dialog', { name: 'Look up' })
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(await screen.findByText('Photosynthesis is a process used by plants.')).toBeTruthy()
    expect(screen.getByText('Biological process')).toBeTruthy()
    expect(wikipedia).toHaveBeenCalledWith('photosynthesis', 'en')
    fireEvent.click(screen.getByRole('button', { name: /Read on Wikipedia/ }))
    expect(open).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/Photosynthesis', 'app')
  })

  it('no article: offers a Wikipedia search', async () => {
    wikipedia.mockResolvedValue(null)
    render(<LookupCard card={card} />)
    expect(await screen.findByText(/No Wikipedia article matches/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Search Wikipedia/ }))
    expect(open).toHaveBeenCalledWith(
      'https://en.wikipedia.org/wiki/Special:Search?search=photosynthesis',
      'app'
    )
  })

  it('offline: says so and can try again; Change site opens Settings', async () => {
    wikipedia.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(null)
    render(<LookupCard card={card} />)
    expect(await screen.findByText(/Couldn’t reach Wikipedia/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/No Wikipedia article matches/)).toBeTruthy()
    expect(wikipedia).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Change site' }))
    expect(useNav.getState().settingsOpen).toBe(true)
  })
})
