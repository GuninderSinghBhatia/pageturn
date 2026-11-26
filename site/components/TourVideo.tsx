'use client'

import { Minus, Square, X } from '@phosphor-icons/react'
import Image from 'next/image'
import { useEffect, useRef } from 'react'

/**
 * The full tour inside a Windows-style app frame. It plays muted on arrival; visitors who ask for
 * reduced motion get the poster and the controls instead.
 */
export function TourVideo(): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    void v.play().catch(() => undefined)
  }, [])
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-1.5 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_64px_-12px_rgba(23,23,23,0.22)]">
      <div className="flex h-9 items-center justify-between px-3 text-xs text-ink-soft">
        <span className="flex min-w-0 items-center gap-2">
          <Image src="/logo.png" alt="" width={14} height={14} className="shrink-0 rounded-sm" />
          <span className="truncate">
            <span className="hidden sm:inline">PageTurn · </span>Alice&rsquo;s Adventures in Wonderland
          </span>
        </span>
        <span className="flex items-center gap-4" aria-hidden>
          <Minus size={12} />
          <Square size={11} />
          <X size={12} />
        </span>
      </div>
      <video
        ref={ref}
        className="block aspect-video w-full rounded-xl bg-ink"
        src="/video/demo.mp4"
        poster="/video/poster.jpg"
        muted
        loop
        playsInline
        controls
        preload="metadata"
        aria-label="PageTurn tour: opening a book, turning pages, highlighting, notes, Ask the book, Who is this, Wikipedia look up, pen, bookmarks, themes, zoom and the notebook"
      />
    </div>
  )
}
