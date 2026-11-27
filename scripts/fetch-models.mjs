// Puts Ask's two models in resources/models/, which the installer ships as <install folder>/models/
// next to the README.txt kept in git.
//
//   npm run fetch-models        (also runs before every `tauri build`)
//
// Which models, at which Hugging Face revision, and the weights' SHA-256 are read from
// src-tauri/src/rag/models.rs, so the app and the installer always agree. Files already there
// with the right checksum are kept; anything missing or damaged is downloaded again.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'models')
const FILES = ['config.json', 'tokenizer.json', 'model.safetensors']

/** The `Spec { ... }` constants in models.rs. */
export function readSpecs(source) {
  const specs = []
  for (const [, body] of source.matchAll(/pub const \w+: Spec = Spec \{([\s\S]*?)\};/g)) {
    const field = (name) => body.match(new RegExp(`${name}: "([^"]+)"`))?.[1]
    const spec = { name: field('name'), repo: field('repo'), rev: field('rev'), sha256: field('weights_sha256') }
    if (Object.values(spec).some((v) => !v)) throw new Error(`could not read a Spec in models.rs:\n${body}`)
    specs.push(spec)
  }
  if (specs.length === 0) throw new Error('no Spec constants found in models.rs')
  return specs
}

async function sha256Of(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function download(url, dest, expectSha) {
  const res = await fetch(url, { headers: { 'User-Agent': 'PageTurn build' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const part = `${dest}.part`
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk)
      done(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(part))
  if (expectSha && hash.digest('hex') !== expectSha) {
    rmSync(part)
    throw new Error(`${url}: checksum mismatch`)
  }
  renameSync(part, dest)
}

async function main() {
  const specs = readSpecs(readFileSync(join(ROOT, 'src-tauri', 'src', 'rag', 'models.rs'), 'utf8'))
  for (const spec of specs) {
    const dir = join(OUT, spec.name)
    mkdirSync(dir, { recursive: true })
    for (const file of FILES) {
      const dest = join(dir, file)
      const sha = file === 'model.safetensors' ? spec.sha256 : null
      if (existsSync(dest) && (!sha || (await sha256Of(dest)) === sha)) continue
      const url = `https://huggingface.co/${spec.repo}/resolve/${spec.rev}/${file}`
      console.log(`fetch-models: downloading ${spec.name}/${file}`)
      await download(url, dest, sha)
    }
  }
  console.log(`fetch-models: ${specs.map((s) => s.name).join(', ')} ready in resources/models`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`fetch-models: ${e.message}`)
    process.exit(1)
  })
}
