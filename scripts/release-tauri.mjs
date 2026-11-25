// Builds the signed Tauri installer and the updater feed, in dist-tauri/. It does NOT publish.
//
//   npm run release:tauri
//
// Then, by hand: create a GitHub release tagged v<version> and attach everything in dist-tauri/
// (the installer, its .sig and latest.json). The app reads
// https://github.com/GuninderSinghBhatia/pageturn/releases/latest/download/latest.json
//
// Needs the signing key in ~/.tauri/pageturn-updater.key (+ pageturn-updater.password), or
// PAGETURN_SIGNING_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Keep that key private and backed up:
// without it installed copies can never be updated.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, buildSigned, latestJson } from './tauri-release-lib.mjs'

const outDir = join(ROOT, 'dist-tauri')
mkdirSync(outDir, { recursive: true })
const built = buildSigned({ outDir })
const baseUrl = `https://github.com/GuninderSinghBhatia/pageturn/releases/download/v${built.version}`
const feed = latestJson({ ...built, baseUrl, notes: process.env.RELEASE_NOTES ?? '' })
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(feed, null, 2) + '\n')
console.log(
  `\nBuilt ${built.setup}\nWrote dist-tauri/latest.json for v${built.version}\nNothing was uploaded.`
)
