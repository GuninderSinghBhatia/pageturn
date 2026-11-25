// Shared by release-tauri.mjs and build-test-installers.mjs: a signed Tauri build.
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..')
export const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')

/** The updater signing key. The key and its passphrase stay OUTSIDE the repository. */
export function signingEnv() {
  const keyFile =
    process.env.PAGETURN_SIGNING_KEY ?? join(homedir(), '.tauri', 'pageturn-updater.key')
  const pwFile = join(homedir(), '.tauri', 'pageturn-updater.password')
  if (!existsSync(keyFile)) throw new Error(`Signing key not found: ${keyFile}`)
  return {
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyFile, 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??
      (existsSync(pwFile) ? readFileSync(pwFile, 'utf8').trim() : '')
  }
}

/**
 * Runs `tauri build` (release, NSIS installer + .sig) with an optional config override and
 * returns the installer and signature paths. One compiler job at a time: a release build with
 * full LTO needs a lot of memory.
 */
export function buildSigned({ config, outDir, env = {} }) {
  const args = ['tauri', 'build']
  if (config) {
    // A file, not inline JSON: the shell would eat the quotes.
    const file = join(ROOT, 'out', `tauri-config-${config.version ?? 'override'}.json`)
    mkdirSync(join(ROOT, 'out'), { recursive: true })
    writeFileSync(file, JSON.stringify(config))
    args.push('--config', `"${file}"`)
  }
  // PAGETURN_SKIP_BUILD=1 re-packages the installer that is already built (no compile).
  if (process.env.PAGETURN_SKIP_BUILD !== '1') {
    const r = spawnSync('npx', args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, CARGO_BUILD_JOBS: '1', ...signingEnv(), ...env }
    })
    if (r.status !== 0) throw new Error(`tauri build failed (exit ${r.status})`)
  }
  const base = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const version = config?.version ?? base.version
  const productName = config?.productName ?? base.productName
  // The exact file name: other builds (e.g. the "PageTurn Test" installers) share the folder.
  const setup = `${productName}_${version}_x64-setup.exe`
  if (!existsSync(join(NSIS_DIR, setup)) || !existsSync(join(NSIS_DIR, `${setup}.sig`))) {
    throw new Error(`Expected ${setup} (and its .sig) in ${NSIS_DIR}`)
  }
  mkdirSync(outDir, { recursive: true })
  copyFileSync(join(NSIS_DIR, setup), join(outDir, setup))
  copyFileSync(join(NSIS_DIR, `${setup}.sig`), join(outDir, `${setup}.sig`))
  return { version, setup, setupPath: join(outDir, setup), sigPath: join(outDir, `${setup}.sig`) }
}

/** The `latest.json` feed the updater reads. `baseUrl` is where the installer will be served. */
export function latestJson({ version, setup, sigPath, baseUrl, notes = '' }) {
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: readFileSync(sigPath, 'utf8').trim(),
        url: `${baseUrl}/${encodeURIComponent(setup)}`
      }
    }
  }
}
