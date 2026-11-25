// Builds two signed installers (1.0.1 and 1.0.2) under a TEST identity, for the installer and
// update tests (tests/installer). The identity ("PageTurn Test", com.pageturn.app.test) has its
// own install folder, shortcut and registry entry and registers no PDF association, so testing
// never touches a real PageTurn installation. Output: out/installer-test/<version>/.
import { join } from 'node:path'
import { ROOT, buildSigned } from './tauri-release-lib.mjs'

const versions = process.argv.slice(2).length ? process.argv.slice(2) : ['1.0.1', '1.0.2']
for (const version of versions) {
  const built = buildSigned({
    outDir: join(ROOT, 'out', 'installer-test', version),
    config: {
      productName: 'PageTurn Test',
      identifier: 'com.pageturn.app.test',
      version,
      bundle: { fileAssociations: [] },
      // Only these test builds may fetch updates over plain http, from the local test server.
      // The real configuration keeps the secure-transport requirement.
      plugins: { updater: { dangerousInsecureTransportProtocol: true } }
    }
  })
  console.log(`Built ${built.setup}`)
}
