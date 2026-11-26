export const REPO = 'https://github.com/GuninderSinghBhatia/pageturn'
/** Always the newest installer: the release script uploads it under this fixed name. */
export const DOWNLOAD_URL = `${REPO}/releases/latest/download/PageTurn-Setup.exe`
export const RELEASES_URL = `${REPO}/releases`
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pageturn.vercel.app'

/**
 * The newest release's version, e.g. "2.0.1", fetched from GitHub at most once an hour.
 * Returns null when GitHub can't be reached, and the page simply leaves the version out.
 */
export async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/GuninderSinghBhatia/pageturn/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' }, next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    const { tag_name } = (await res.json()) as { tag_name?: string }
    return tag_name ? tag_name.replace(/^v/, '') : null
  } catch {
    return null
  }
}
