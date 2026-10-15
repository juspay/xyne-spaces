# Mobile app — developer setup

Expo (SDK 57) / React Native app. It installs on its own, with its own lockfile, so its
dependencies never change the rest of the monorepo. `@xyne/shared` is linked from
`packages/shared`. Run every command from `apps/mobile` unless noted.

## 1. Prerequisites

- **Node 22** (`nvm use` reads `.nvmrc`) and **pnpm 10.15** (`corepack enable`).
- **iOS:** Xcode with an iOS Simulator, and CocoaPods.
- **Android:** Android Studio, with the SDK in its default location (`~/Library/Android/sdk`).
  It includes the emulator and the JDK Gradle needs.

## 2. Install

```bash
(cd ../.. && pnpm install)   # repository root: installs and builds @xyne/shared
pnpm install                 # the app
```

After changing `packages/shared`, run `pnpm run build:shared` from the repository root.

Each variant needs its Firebase config, which is gitignored: get `google-services.json` and
`GoogleService-Info.plist` from the team and put them in `assets/configs/<variant>/`
(for example `assets/configs/dev/`).

## 3. Run (dev)

```bash
pnpm ios:dev
pnpm android:dev
```

The first run generates the native projects and takes a while. For JS-only changes afterwards,
`pnpm start:dev` is enough.

## 4. Run against prod

Also needs `.env.prod` and `assets/secrets/` (release keystore) from the team, both gitignored.

```bash
pnpm prebuild:prod
pnpm ios:prod:debug
pnpm android:prod:debug
```

Re-run the prebuild after switching variants or changing `app.config.js`, `plugins/` or a native
dependency. The same commands exist for `sandbox` and `community`.

## 5. Android release builds and integrity checks

Release builds of `prod` and `community` verify their signing certificate, refuse to run when
debuggable, and require installation from the Play Store. Debug builds skip these checks. The
prebuild reads them from the env file:

- `LOTUS_INTEGRITY_SIGNING_SHA256` — required certificate pin(s), comma-separated.
- `LOTUS_INTEGRITY_ALLOWED_INSTALLERS` — default `com.android.vending`; empty skips the install check.
- `LOTUS_INTEGRITY_ENFORCED` — `false` turns all checks off.

| Build | Commands |
|-------|----------|
| Play Store bundle (with integrity) | `pnpm prebuild:prod` then `pnpm android:prod:bundle` |
| Release APK on a device over adb | `LOTUS_INTEGRITY_ALLOWED_INSTALLERS= pnpm prebuild:prod` then `pnpm android:prod` |
| Release APK without integrity (debugging only, never ship) | `LOTUS_INTEGRITY_ENFORCED=false pnpm prebuild:prod` then `pnpm android:prod` |

## 6. Before a PR

```bash
pnpm validate   # typecheck, lint, format check
pnpm test
```

## 7. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Failed to resolve the Android SDK path` / `spawn adb ENOENT` | Install Android Studio and let it download the SDK to the default location. |
| `pod install` fails with `Unicode Normalization not appropriate for ASCII-8BIT` | `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`, then retry. |
| Stale `@xyne/shared` types | `pnpm run build:shared` from the repository root. |
| App stuck on the dev launcher | Run `pnpm start:dev` and pick the server. |
| Metro cache errors | `pnpm start:dev --clear` |
