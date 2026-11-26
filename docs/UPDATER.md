# Signed updates (Tauri build)

How PageTurn updates itself, how to publish a release, and how it is tested.

## How it works

- The app checks for a newer version 10 seconds after start-up and every 4 hours (release builds
  only). It reads `latest.json` from
  `https://github.com/GuninderSinghBhatia/pageturn/releases/latest/download/latest.json`.
- If the feed names a newer version, the installer is downloaded in the background and checked
  against the **public key in `src-tauri/tauri.conf.json`**. A file that was not signed by the
  matching private key, or that was changed after signing, is dropped and never installed.
- The page is told with the same events as before (`update:available`, `update:downloaded`); "Restart
  now" calls `app.installUpdate()`, which runs the installer in passive mode and starts the new
  version. The library and settings are not touched (they live in `%APPDATA%\PageTurn`).
- The feed must use `https`. Only the test builds relax this (see below).
- Code: `src-tauri/src/updater.rs`, `src-tauri/src/commands/app.rs`.

## The signing key (keep it safe)

|             |                                                                      |
| ----------- | -------------------------------------------------------------------- |
| Private key | `%USERPROFILE%\.tauri\pageturn-updater.key` (outside the repository) |
| Passphrase  | `%USERPROFILE%\.tauri\pageturn-updater.password`                     |
| Public key  | in `tauri.conf.json` → `plugins.updater.pubkey`                      |

Whoever holds the private key can ship code to every installed copy. **Back it up somewhere
private** (without it, installed apps can never be updated, because they only trust this key) and
never commit it. To rotate it, a release signed with the old key must first ship the new public key.

## Publishing a release

1. Raise the version in `src-tauri/tauri.conf.json` (and `package.json`, `src-tauri/Cargo.toml`).
2. `npm run release` builds the installer and its `.sig` and writes `dist-tauri/latest.json`, plus
   `dist-tauri/PageTurn-Setup.exe` (a copy under the fixed name the README's download button
   links to). It uploads nothing.
3. Create a GitHub release `v<version>` and attach `dist-tauri/*` (the installer, the `.sig`,
   `latest.json`, `PageTurn-Setup.exe`). Installed apps pick it up within 4 hours.

Existing **1.x** users cannot update into the Tauri app (different updater); they need to
download the new installer once.

## Testing

`npm run tauri:test:installers:build` builds two signed installers (1.0.1 and 1.0.2) under a
**test identity** ("PageTurn Test", its own folder, shortcut and registry entry, no PDF
association) so a real PageTurn installation is never touched. Only these builds set
`dangerousInsecureTransportProtocol`, so they can talk to a local `http` server.

`npm run tauri:test:installers` then:

1. installs 1.0.1 silently into a temp folder and checks files, uninstaller, registry entry and
   shortcut, and that a real install is unchanged;
2. starts the installed app (version, UI, page security policy, "same version = current");
3. refuses a 1.0.2 installer signed with another key, and one modified after signing;
4. accepts the correctly signed 1.0.2, installs it, restarts into 1.0.2 and keeps the library;
5. uninstalls and checks the program, registry entry and shortcut are gone and the library stays.
