import Image from 'next/image'
import Link from 'next/link'
import { DOWNLOAD_URL, REPO, RELEASES_URL } from '@/lib/site'

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Tour', href: '/#tour' },
      { label: 'How it works', href: '/#rag' },
      { label: 'Download', href: DOWNLOAD_URL }
    ]
  },
  {
    title: 'Project',
    links: [
      { label: 'Source code', href: REPO },
      { label: 'Releases', href: RELEASES_URL }
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' }
    ]
  }
]

const linkClass =
  'rounded-sm text-sm text-ink-soft transition-colors duration-300 ease-fluid hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-ink/8 bg-canvas-2 px-6 pt-16 text-ink">
      <div className="mx-auto grid max-w-6xl grid-cols-3 gap-x-6 gap-y-10 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-3 md:col-span-1">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Image src="/logo.png" alt="" width={22} height={22} className="rounded-md" />
            PageTurn
          </Link>
          <p className="mt-4 text-xl leading-snug font-semibold tracking-[-0.02em]">
            Read with an AI.
            <span className="block text-ink/40">Free for Windows.</span>
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-xs font-medium text-ink/45">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className={linkClass}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto mt-14 flex max-w-6xl flex-col justify-between gap-2 border-t border-ink/8 py-6 text-xs text-ink-soft sm:flex-row">
        <p>© {new Date().getFullYear()} PageTurn</p>
        <p>No account, no tracking. Your notes stay on your computer.</p>
      </div>

      {/* The name, set large and faint, sitting whole on the bottom edge. */}
      <p
        aria-hidden
        className="mx-auto max-w-6xl pb-4 text-center text-[clamp(3.5rem,17vw,14rem)] leading-[0.85] font-semibold tracking-[-0.04em] text-ink/5 select-none"
      >
        PageTurn
      </p>
    </footer>
  )
}
