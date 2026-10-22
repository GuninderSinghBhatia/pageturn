/*
 * electron-builder afterPack hook: flips Electron's security fuses in the packaged binary.
 * RunAsNode off, cookie encryption on, NODE_OPTIONS and --inspect off, asar integrity
 * validation on, app code loaded only from the asar archive.
 */
const { join } = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function fuses(context) {
  // Test builds only: automation (Playwright) needs the inspector the fuses switch off.
  if (process.env.PAGETURN_NO_FUSES === '1') return
  const { appOutDir, electronPlatformName, packager } = context
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
