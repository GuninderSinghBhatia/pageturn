import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms · PageTurn',
  description: 'The terms for using PageTurn and this website.'
}

export default function Terms(): React.JSX.Element {
  return (
    <LegalPage title="Terms" updated="26 November 2026">
      <p>
        PageTurn is free to download and use for personal and commercial reading. By installing it,
        you agree to the terms below.
      </p>
      <h2>No warranty</h2>
      <p>
        PageTurn is provided as it is, without warranty of any kind. Keep your own copies of
        important files. PageTurn never changes your PDFs, but you are responsible for your data.
      </p>
      <h2>Your content</h2>
      <p>
        The books you open and the notes you write are yours. PageTurn does not collect, read or
        upload them.
      </p>
      <h2>Third party services</h2>
      <p>
        Look up, web search and AI help connect to services you choose. Their own terms apply when
        you use them.
      </p>
    </LegalPage>
  )
}
