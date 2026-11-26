'use client'

import { useEffect, useRef, useState } from 'react'

export type Feature = { clip: string; title: string; body: string }

/** Each clip gets at least this long on screen; short ones replay until it has passed. */
const MIN_MS = 5000

/**
 * One large player and the list of features beside it. The selected feature's clip plays, then
 * the next one takes over; clicking a feature jumps to it. Reduced motion: no autoplay, no
 * advancing, the poster of the selected feature.
 */
export function FeatureShowcase({ features }: { features: Feature[] }): React.JSX.Element {
  const [active, setActive] = useState(0)
  const [visible, setVisible] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const started = useRef(0)
  const still = useRef(false)

  useEffect(() => {
    still.current = matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const v = video.current
    if (!v) return
    started.current = performance.now()
    if (visible && !still.current) void v.play().catch(() => undefined)
    else v.pause()
  }, [active, visible])

  const onEnded = (): void => {
    const v = video.current
    if (!v) return
    if (performance.now() - started.current < MIN_MS) {
      v.currentTime = 0
      void v.play().catch(() => undefined)
    } else setActive((a) => (a + 1) % features.length)
  }

  const f = features[active]
  return (
    <div ref={root} className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
      <ol className="order-2 space-y-1 lg:order-1">
        {features.map((x, i) => {
          const on = i === active
          return (
            <li key={x.clip}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-current={on ? 'true' : undefined}
                className={`w-full rounded-xl px-4 py-3 text-left transition-colors duration-300 ease-fluid focus-visible:outline-2 focus-visible:outline-brand ${
                  on ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(23,23,23,0.14)] ring-1 ring-ink/8' : 'hover:bg-ink/[0.03]'
                }`}
              >
                <span className={`block text-base font-semibold ${on ? 'text-ink' : 'text-ink-soft'}`}>{x.title}</span>
                <span
                  className={`grid text-sm text-ink-soft transition-[grid-template-rows,opacity] duration-500 ease-fluid ${
                    on ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <span className="overflow-hidden">
                    <span className="block pt-1">{x.body}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="order-1 rounded-2xl border border-ink/10 bg-white p-1.5 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_64px_-12px_rgba(23,23,23,0.18)] lg:order-2">
        <video
          ref={video}
          key={f.clip}
          className="block aspect-4/3 w-full rounded-xl bg-paper object-cover"
          src={`/video/clips/${f.clip}.mp4`}
          poster={`/video/clips/${f.clip}.jpg`}
          muted
          playsInline
          preload="auto"
          onEnded={onEnded}
          aria-label={`${f.title}: ${f.body}`}
        />
      </div>
    </div>
  )
}
