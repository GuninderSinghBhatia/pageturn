import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy · PageTurn',
  description: 'PageTurn collects no usage data. Your books, highlights and notes stay on your computer.'
}

export default function Privacy(): React.JSX.Element {
  return (
    <LegalPage title="Privacy" updated="26 November 2026">
      <p>
        PageTurn is a desktop app. It has no account, no analytics and no usage tracking. This page
        explains the few times it talks to the internet, and what stays on your computer.
      </p>
      <h2>What stays on your computer</h2>
      <p>
        Your library, reading positions, highlights, notes, ink and bookmarks are stored in a local
        database in your Windows user data folder. Daily backups are written to the same place.
        None of it is uploaded anywhere.
      </p>
      <h2>When PageTurn uses the internet</h2>
      <p>
        <strong className="text-ink">Updates.</strong> PageTurn checks GitHub for a newer version
        and downloads it if there is one.
      </p>
      <p>
        <strong className="text-ink">Look up and web search.</strong> When you choose Look up, the
        selected text is sent to the site you picked in Settings (Wikipedia by default).
      </p>
      <p>
        <strong className="text-ink">AI help.</strong> Only if you add your own API key. The passage
        you select and your question are sent to that provider (Anthropic, OpenAI or Google) under
        your own account. The key is stored encrypted on your computer.
      </p>
      <h2>This website</h2>
      <p>
        This site sets no cookies and runs no analytics. It is hosted on Vercel, which keeps standard
        server logs. The download comes from GitHub.
      </p>
    </LegalPage>
  )
}
