import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import { Footer } from './Footer'

export function LegalPage({
  title,
  updated,
  children
}: {
  title: string
  updated: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <main id="main" className="px-6 py-24">
        <article className="mx-auto max-w-2xl">
          <Link
            href="/"
            className="mb-12 inline-flex items-center gap-2 rounded-full text-sm text-ink-soft transition-all duration-700 ease-fluid hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-deep"
          >
            <ArrowLeft size={16} aria-hidden />
            Back to PageTurn
          </Link>
          <h1 className="mb-2 text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="mb-12 text-sm text-ink-soft">Last updated {updated}</p>
          <div className="space-y-6 text-base text-ink-soft [&_h2]:mt-12 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink">
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  )
}
