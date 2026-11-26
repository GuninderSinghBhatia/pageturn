'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { DOWNLOAD_URL } from '@/lib/site'
import { primaryButton } from './DownloadButton'

const LINKS = [
  { id: 'tour', label: 'Tour' },
  { id: 'features', label: 'Features' },
  { id: 'rag', label: 'How it works' }
]

/** Floating white pill; on small screens a hamburger that morphs into an X and opens a full overlay. */
export function Nav(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)

  // The section in the middle band of the viewport is the current one.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id)
      },
      { rootMargin: '-45% 0px -50% 0px' }
    )
    for (const l of LINKS) {
      const el = document.getElementById(l.id)
      if (el) io.observe(el)
    }
    const top = document.getElementById('top')
    if (top) io.observe(top)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 top-0 z-50 mx-auto mt-6 flex w-max items-center gap-2 rounded-full border border-ink/10 bg-white/85 p-1.5 pl-4 text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(23,23,23,0.12)] backdrop-blur-md"
      >
        <a href="#top" className="mr-2 flex items-center gap-2 rounded-full text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
          <Image src="/logo.png" alt="" width={24} height={24} className="rounded-md" />
          PageTurn
        </a>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.id}>
              <a
                href={`#${l.id}`}
                aria-current={active === l.id ? 'true' : undefined}
                className="rounded-full px-3 py-2 text-sm text-ink-soft transition-colors duration-300 ease-fluid hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand aria-[current]:bg-ink/5 aria-[current]:text-ink"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <a href={DOWNLOAD_URL} className={`${primaryButton} hidden px-3 py-1.5 text-sm md:inline-flex`}>
          Download
        </a>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
          className="relative z-60 size-10 rounded-full transition-all duration-700 ease-fluid hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand md:hidden"
        >
          <span
            className={`absolute left-3 h-0.5 w-4 rounded-full bg-current transition-all duration-700 ease-fluid ${
              open ? 'top-4.75 rotate-45' : 'top-4'
            }`}
          />
          <span
            className={`absolute left-3 h-0.5 w-4 rounded-full bg-current transition-all duration-700 ease-fluid ${
              open ? 'top-4.75 -rotate-45' : 'top-6'
            }`}
          />
        </button>
      </nav>

      <div
        id="mobile-menu"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-0 z-40 bg-canvas/95 backdrop-blur-md transition-all duration-700 ease-fluid md:hidden ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
        onClick={() => setOpen(false)}
      >
        <ul className="flex h-full flex-col items-center justify-center gap-6">
          {[...LINKS, { id: 'download', label: 'Download' }].map((l, i) => (
            <li
              key={l.id}
              className={`transition-all duration-700 ease-fluid ${open ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              style={{ transitionDelay: `${100 + i * 50}ms` }}
            >
              <a
                href={l.id === 'download' ? DOWNLOAD_URL : `#${l.id}`}
                className="text-3xl font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
