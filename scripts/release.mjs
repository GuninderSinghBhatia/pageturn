/*
 * Publishes an update: npm run release
 *   1. bumps the version (1.0.1 → 1.0.2…), commits and tags it
 *   2. pushes the commit and the tag
 *   3. builds the installer and uploads it, with latest.yml, to a GitHub Release
 * Installed copies of PageTurn find it within a few hours (or at their next start) and
 * offer "Restart now". Uses GH_TOKEN, or the GitHub CLI login on this computer.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd, env = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '' } })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

if (out('git status --porcelain')) {
  console.error('Commit or stash your changes first: a release is built from a clean tree.')
  process.exit(1)
}
const token = process.env.GH_TOKEN || out('gh auth token')
if (!token) {
  console.error('No GitHub token: run "gh auth login" or set GH_TOKEN.')
  process.exit(1)
}

run('npm version patch -m "release: v%s"')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const branch = out('git rev-parse --abbrev-ref HEAD')
run(`git push origin ${branch}`)
run(`git push origin refs/tags/v${version}`)
run('npx electron-vite build')
run('npx electron-builder --win --publish always', { GH_TOKEN: token })
console.log(`\nPageTurn ${version} is published. Installed apps will offer it shortly.`)
