import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BooksRepo } from './db/repositories/books'
import type { SettingsRepo } from './db/repositories/settings'
import { importAsBooks } from './ipc/library'

const SAMPLE = 'Welcome-to-PageTurn.pdf'

/** The bundled Welcome book: next to the app when packaged, in resources/ during development. */
export const samplePath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'sample', SAMPLE)
    : join(__dirname, '..', '..', 'resources', 'sample', SAMPLE) // out/main → repo root

/**
 * Runs once per install. A brand-new library gets the Welcome book and the tour; an
 * existing library (an update) is left as it is, without the tour. Tests opt out with
 * PAGETURN_SKIP_ONBOARDING=1.
 */
export async function setUpFirstRun(books: BooksRepo, settings: SettingsRepo): Promise<void> {
  if (settings.get().sampleImported) return
  const fresh = books.list().length === 0
  if (process.env.PAGETURN_SKIP_ONBOARDING === '1' || !fresh) {
    settings.set({ sampleImported: true, onboardingDone: true })
    return
  }
  const file = samplePath()
  try {
    if (existsSync(file)) await importAsBooks(books, [file])
  } catch (err) {
    console.error('Could not add the Welcome book', err)
  }
  settings.set({ sampleImported: true })
}
