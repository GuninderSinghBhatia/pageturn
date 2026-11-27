import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { SITE_URL } from '@/lib/site'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })

const title = 'PageTurn: a free AI PDF reader for Windows that knows your book'
const description =
  'Open any PDF as a two page book with an AI assistant built in: ask the book with page cited answers, Who is this? without spoilers, and explanations with your own key. Plus highlights, notes and a pen. Free for Windows 10 and 11.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  applicationName: 'PageTurn',
  keywords: ['AI PDF reader', 'RAG', 'Self-RAG', 'vector RAG', 'chat with PDF','PDF reader', 'Windows PDF reader', 'ebook reader', 'page flip', 'PDF annotation'],
  openGraph: {
    type: 'website',
    title,
    description,
    siteName: 'PageTurn',
    images: [{ url: '/opengraph-image.jpg', width: 1920, height: 1080, alt: 'PageTurn showing a book mid page turn' }]
  },
  twitter: { card: 'summary_large_image', title, description }
}

export const viewport: Viewport = {
  themeColor: '#fafaf9',
  colorScheme: 'light'
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={geist.variable}>
      <body className="font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
