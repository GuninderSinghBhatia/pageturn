'use client'

import { useEffect, useRef } from 'react'

/**
 * A short silent loop that plays only while it's on screen (and never for visitors who ask for
 * reduced motion; they see the poster).
 */
export function Clip({
  src,
  poster,
  label,
  className
}: {
  src: string
  poster: string
  label: string
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => undefined)
        else v.pause()
      },
      { threshold: 0.4 }
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])
  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-label={label}
    />
  )
}
