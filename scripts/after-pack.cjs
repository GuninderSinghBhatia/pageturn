/*
 * electron-builder afterPack hook.
 * 1. Trims what PageTurn never uses, to keep the installer small:
 *    - better-sqlite3 sources and the native builds for other platforms
 *    - the DirectX 12 shader compiler (dxcompiler/dxil), used only by WebGPU; page turns use
 *      WebGL through ANGLE's Direct3D 11 backend (d3dcompiler_47.dll stays)
 * 2. Flips Electron's security fuses: RunAsNode off, cookie encryption on, NODE_OPTIONS and
 *    --inspect off, asar integrity validation on, app code loaded only from the asar archive.
 */
const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

function trim(appOutDir, platform, arch) {
  const resources = platform === 'darwin' ? null : join(appOutDir, 'resources')
  if (resources) {
    const sqlite = join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
    for (const dir of ['deps', 'src', 'build']) rmSync(join(sqlite, dir), { recursive: true, force: true })
    const prebuilds = join(sqlite, 'prebuilds')
    if (existsSync(prebuilds)) {
      for (const f of readdirSync(prebuilds)) {
        if (f !== `${platform}-${arch}.node`) rmSync(join(prebuilds, f), { force: true })
      }
    }
  }
  if (platform === 'win32') {
    for (const f of ['dxcompiler.dll', 'dxil.dll']) rmSync(join(appOutDir, f), { force: true })
  }
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager, arch } = context
  const archName = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[arch] ?? 'x64'
  trim(appOutDir, electronPlatformName, archName)

  // Test builds only: automation (Playwright) needs the inspector the fuses switch off.
  if (process.env.PAGETURN_NO_FUSES === '1') return
  const name = packager.appInfo.productFilename
  const exe =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${name}.app`)
      : electronPlatformName === 'win32'
        ? join(appOutDir, `${name}.exe`)
        : join(appOutDir, packager.executableName)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
}
