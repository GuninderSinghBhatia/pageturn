import Image from 'next/image'
import Link from 'next/link'
import { primaryButton } from '@/components/DownloadButton'

export default function NotFound(): React.JSX.Element {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center text-ink">
      <Image src="/logo.png" alt="" width={64} height={64} className="rounded-2xl" />
      <h1 className="max-w-170 text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
        This page was torn out
        <span className="block text-ink/40">
          but the <span className="text-spark">book</span> is fine.
        </span>
      </h1>
      <p className="max-w-170 text-lg text-ink-soft">The link may be old, or the address has a typo.</p>
      <Link href="/" className={`${primaryButton} px-5 py-3 text-base`}>
        Back to PageTurn
      </Link>
    </main>
  )
}
