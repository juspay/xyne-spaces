# Electron Distribution & Update Architecture

Status: proposal. Collapses the per-flavour build matrix into two channels, moves per-domain configuration out of the source tree and into a build parameter, and gives the internal channel a real signed release pipeline with automatic updates.

## 1. Problems with the current distribution model

Tenant identity is baked into the binary, so every new domain is a new build, a new signing run, and a new hosting location.

| Concept | Where it was frozen | Owned by | Status |
|---|---|---|---|
| Backend/frontend hostnames | `src/app/config.ts` — `APP_ENV` selected one of three literal objects, editing the tree being the only way to add a fourth | Tenant, selected at build time (§3) | **done** |
| mTLS trust root | `src/services/mtls.ts` — CA filename derived from `USER_DATA_SUFFIX === '-sandbox'`, so a third CA had no way to be named | Tenant, via `CA_CERT_FILE` (`mtls.ts:123`) | **done** |
| Bundle identity (appId, productName, scheme) | `build.prod.json` / `build.sbx.json` | Channel — never tenant | by design |
| UI bundle | `UI_ZIP_URL` + `RELEASE_CONFIG_URL`, already OTA | Tenant | works |
| Shell version | nothing — no update path exists | Release (§5) | **missing** |

Consequences:

- **Combinatorial builds, and worse, combinatorial *source*.** A merchant domain with its own app config required a fourth literal object in `config.ts`, then a fifth, each one a commit to the shared tree. Cost was `tenants × platforms × arch` in build time and, more expensively, one code review per customer. §3 removes the source half of this: a domain is now a data file and a build parameter. The build half remains `tenants × platforms × arch` for the internal channel and is accepted deliberately — see §3.
- **No single download origin.** Each per-domain build implies a per-domain host, so there is no one place to point a user at.
- **Not publishable to stores.** Apple guideline 4.3(a) rejects multiple bundle IDs of one app differing only by brand or content, and names a single binary with in-app selection as the expected architecture. Play and Microsoft Store apply equivalent spam policies. Per-domain builds are not merely expensive; they cannot be listed.
- **Private-CA mTLS is incompatible with store distribution.** `mtls.ts:119-140` calls `keychain.installRootCA()`, which shells out to `security add-trusted-cert`. A sandboxed Mac App Store build cannot modify the system trust store, and on iOS/Android an app cannot install a root CA at all without an MDM profile. A reviewer launching the app with no client certificate also sees a dead app — guideline 2.1.
- **The native shell has no update path.** `grep -rn 'electron-updater\|autoUpdater' apps/electron/src` returns nothing. Only the UI self-updates (`ui-updater.ts`). Every Electron/Chromium security fix currently needs a manual reinstall in every org.
- **Nothing is signed — deliberately, and correctly for today.** `build.prod.json` carries `"notarize": false`, `dmg.sign: false`, `win.signExecutable: false` because the only live distribution path is an MDM-pushed `pkg`, and notarizing a `pkg` is disproportionately expensive (§7.1). An MDM install sets no `com.apple.quarantine` attribute, so Gatekeeper's quarantine check never runs and an unsigned `pkg` installs cleanly. Signing blocks nothing on this path. It blocks exactly the two paths that need a trust anchor: a no-MDM download, and any self-update.
- **No release pipeline.** `.github/workflows/` has no Electron job. Releases are a laptop ritual.

## 2. Target: two channels, split by trust model

The axis is not tenant and not environment. It is **how the binary is trusted and who owns updates.**

Two channels by trust model, and the internal channel carries two *delivery paths* that differ only in who installs the bytes.

| | Community channel | Internal — MDM path | Internal — no-MDM path |
|---|---|---|---|
| Audience | SaaS, community, external, merchant domains | orgs with MDM (today's only live path) | mTLS/VPN orgs without MDM, gov, air-gapped |
| Domain shape | open, like Slack — any tenant under the public origin | tenant-specific, often private DNS | same |
| TLS | public CA only (ACM / Let's Encrypt) | private CA + client certificates | same |
| Device identity | App Attest (iOS), Play Integrity (Android), keychain/TPM-bound key + enrollment token (desktop) | existing mTLS client certificate | same |
| Root CA install | **never** — compiled out | `installRootCA` as today | `installRootCA` as today |
| macOS artifact | store build | **unsigned `pkg`** — MDM only | notarized `dmg` + `zip`, never `pkg` |
| Windows artifact | MSIX | `msi` (`perMachine: true`) | `nsis` (`perMachine: false`) |
| Signing | store-owned | **none needed** | Developer ID **Application** only |
| Updates | store-owned; self-update compiled out (brew/apt excepted) | **MDM-owned** — self-update off | `electron-updater`, self-hosted feed |
| Distribution | App Store, Play, Microsoft Store, brew cask, apt/yum | MDM push | direct download, org mirror |
| Bundle id | `com.xyne.spaces` | `com.xyne.spaces.internal` | `com.xyne.spaces.internal` |

Two binaries per platform. Not `N`. The MDM and no-MDM paths are the *same* build with different signing and a different update flag, so they are one pipeline with two publish steps — not two codebases.

The sequencing follows from the table: the MDM column needs no secrets and no signing, so it can be automated immediately. The no-MDM column is where signing cost lands, and it can wait.

The property that forced per-domain builds — a private CA in the OS trust store — exists only in the right-hand column, and that column is the one that is *not* store-distributed, so a direct download is available to it. The constraint and its escape hatch live in the same place.

### Why this is what Slack does

Slack ships one binary per platform and one listing per store (`com.tinyspeck.slackmacgap`). Their desktop rewrite explicitly removed "a fundamental assumption of the original design that there is only ever a single workspace running at a time" and made all code multi-workspace aware; the app is the session manager holding every sign-in. Workspaces are added at runtime by email magic link or typed workspace URL.

This works because every Slack tenant is `*.slack.com`: one origin, one public TLS chain, one trust root compiled in, no per-tenant CA, no client certificates. Device trust is delegated to the IdP and EMM, never pushed into the client's trust store. GovSlack is a separate domain and separate compliance boundary — a per-*regime* split, not a per-customer one. Slack's only per-org client config is MDM (plist on macOS, ADMX on Windows); without MDM their answer is "type your workspace URL".

So the community channel is Slack's model applied unchanged. The internal channel is the case Slack does not have, and it is handled by *not* putting it in a store.

## 3. Tenant config at build time

**Implemented.** A domain is a data file plus a build parameter. No source change, no new build config, no runtime discovery.

### Split of ownership

Baked per **channel**, immutable, inside the code signature. A tenant may not override these:

```
APP_ID, APP_NAME, DEEP_LINK_PROTOCOL, USER_DATA_SUFFIX
UNPROTECTED_URL            // bootstrap host, reachable before enrollment
```

They sit inside the macOS code signature and the MDM package identity. Changing `APP_ID` or `USER_DATA_SUFFIX` per tenant means an upgrade over an existing install becomes a second app with an empty profile, so these stay channel-level even though nothing technically prevents moving them.

Selected per **tenant** at build time:

```
BACKEND_URL, MTLS_BACKEND_URL, MTLS_FRONTEND_URL, FRONTEND_URL, CLAW_AUTH_URL
MTLS_IDENTITY_NAME, CA_CERT_FILE
UI_ZIP_URL, RELEASE_CONFIG_URL
enableMtls, sendLogs, enableOtelMetrics, uiUpdateCheckIntervalMs
window.title
```

`CA_CERT_FILE` is the one genuinely new field. `mtls.ts` previously derived the CA filename from `USER_DATA_SUFFIX === '-sandbox'`, which gave a third deployment no way to name its own root; `mtls.ts:123` now reads `config.CA_CERT_FILE`, so a per-domain private CA is a config value rather than a branch.

### Mechanism

| Piece | Location | Repo |
|---|---|---|
| Tenant data | `apps/electron/tenants/<domain>.json` | **private** (public carries only `example.json`) |
| Private CA root | `apps/electron/certs/ca.<domain>.cert` | **private** |
| Selector | `apps/electron/scripts/select-tenant.mjs` | public |
| Generated module | `apps/electron/src/app/tenant.active.ts` | git-ignored, never committed |
| Build parameter | `ELECTRON_TENANT` (Make var, Jenkins string param) | both |

Flow:

1. Jenkins runs with `ELECTRON_TENANT=acme`.
2. `overlayPublicRepo()` copies the public tree in with `rsync --ignore-existing`, so the private `tenants/acme.json` and `certs/ca.acme.cert` are never shadowed by anything public.
3. `select-tenant.mjs acme` reads `tenants/acme.json` and writes `src/app/tenant.active.ts`.
4. `tsc` compiles it. `config.ts` overlays it on the channel defaults.

Precedence, lowest to highest: **channel default → tenant file → environment variable.** The environment stays on top as the operator's escape hatch for repointing an already-built binary.

Empty `ELECTRON_TENANT` is a first-class case, not a degenerate one: it clears any previous selection and keeps the channel defaults, which is exactly what the community and sandbox channels want. An *unknown* tenant name is a hard error — a typo must never silently produce a default-configured binary wearing a customer's name.

### Validation is the compiler's job

`select-tenant.mjs` writes the tenant data as a typed object literal:

```ts
export const tenant: TenantConfig = { "BACKEND_URL": "https://app.spaces.acme.com", … };
```

`TenantConfig` is derived from `AppConfig`, so `tsc` rejects a misspelled key (`BACKEND_UR` → TS2353, with a "did you mean" hint) and a wrong type (`"enableMtls": "yes"` → TS2322). This is deliberate: no JSON Schema to drift out of sync with the interface, no validation dependency, and `AppConfig` stays the single definition of the shape. The script checks only what a type cannot see — that the file exists, parses, and is a non-empty flat object.

Two properties of the generated module matter:

- **It holds one tenant at a time.** No artifact carries another deployment's hostnames, which a barrel of all tenants under `src/` would have caused — `tsc` compiles everything under `src/`, and electron-builder packs all of `dist`.
- **It is git-ignored and cleared on every run, including its emitted `dist/app/tenant.active.js`.** `tsc` does not delete output for a source file that has gone away, so clearing only the `.ts` left the compiled module behind and an "untenanted" rebuild in a reused workspace resolved to the *previous* tenant's hostnames. Verified and fixed; the macOS host route is where it would have bitten, since `dist/` persists there between runs.

### Cost, stated plainly

This is `tenants × platforms × arch` builds for the internal channel. That cost is accepted because the internal channel is not store-distributed (§2), so the guideline 4.3(a) objection that makes per-domain builds *unpublishable* does not apply to it. What the design removes is the per-customer commit to shared source, which was the expensive half.

The community channel is unaffected: one untenanted build, one listing per store, tenants distinguished by the workspace URL a user types — Slack's model, unchanged.

## 4. Rejected: multi-tenant in one install

An earlier draft moved tenant identity to runtime: `.well-known/xyne-desktop-config.json` discovery, Ed25519-signed config documents, per-tenant `userData` subtrees, `session.fromPartition('persist:tenant-<id>')`, and a workspace switcher.

Dropped, for the internal channel. Recorded here because the option is reasonable and will be proposed again.

| Against | |
|---|---|
| Trust bootstrapping | A runtime-fetched config for the internal channel carries a **CA certificate**. A client that accepts a trust root off the network is a client an attacker can repoint, so the document needs offline Ed25519 signing, a pubkey compiled into the binary, and no warn-and-continue path. That is a signing service and a key-custody process to replace a JSON file in a private repo. |
| Two trust models | Community configs carry only hostnames, where public TLS is sufficient. Internal configs carry trust material, where it is not. One mechanism serving both means the weaker verification path exists in the binary that needs the stronger one. |
| No demand for coexistence | Per-tenant partitions and a switcher only pay off when one user holds several internal workspaces at once. Each org installs the build for its own domain; this does not happen. |
| Migration risk for zero user-visible gain | `USER_DATA_SUFFIX`, `ui-updater.ts` paths, keychain keys and cookie partitions all become tenant-relative. A path migration across an installed fleet with no MDM to repair it, in exchange for a switcher nobody asked for. |

What survives from that draft: `UNPROTECTED_URL` keeps its pre-enrollment bootstrap role, and runtime config remains the right answer for the **community** channel, where a tenant is a hostname the user types and no trust material is involved.

The version floor (`minShellVersion`, §5) stays runtime and server-side regardless. It is a security backstop, so it cannot live in a file that is fixed at build time.

## 5. Internal no-MDM path: download once, update everything

This section applies to the no-MDM column only. On the MDM path, layer 1 is the MDM's job and `electron-updater` stays compiled out; layer 2 works identically on both paths, which is why an MDM org still gets same-day UI fixes today.

Four layers update on three independent cadences. The rule that keeps this cheap: **anything that can live in a faster layer must live there.**

| Layer | Contents | Cadence | Mechanism | Today |
|---|---|---|---|---|
| 0 — installer | first download only | once | MDM push, or branded redirect to channel artifact | MDM push, built by hand |
| 1 — shell | Electron, Chromium, main process, `native/mic-monitor` | weeks | `electron-updater`, background download, install on quit | **missing entirely** |
| 2 — UI | dashboard web assets | 15 min | existing OTA, staged + apply on blur | works |
| 3 — version floor | `minShellVersion` only | launch + periodic | server-side rejection, rendered as a blocking modal | **missing** |

Hostnames and flags are deliberately **not** a layer here: §3 fixes them at build time for the internal channel. The only thing in this column that must change without a rebuild is the version floor, and it must, because it is a security backstop (§4).

Layer 1 is reserved for what genuinely cannot ship as web assets: Chromium security fixes, native helpers, main-process logic. Everything else goes to layer 2, so the heavy signature-bound track stays rare.

Layer 2 already has the right interaction pattern — `ui-updater.ts:480-531` stages the update, then applies it on the window's `blur` event rather than interrupting the user. Layer 1 mirrors it with `autoInstallOnAppQuit`.

### Update transport

`electron-updater` uses Node's `https`, not Electron's `net`, so the `app.on('select-client-certificate')` handler in `mtls.ts:74` does **not** apply to it. An mTLS-protected feed will not work without writing a custom transport.

Host the internal feed on the public bootstrap host instead:

```
https://spaces.xyne.juspay.net/update/internal/{platform}/latest*.yml
https://spaces.xyne.juspay.net/download/internal/{platform}/{arch}
```

This is safe only because the artifact's OS code signature is the trust anchor, not the transport: `electron-updater` checks the `sha512` in `latest.yml` and verifies the Authenticode or `codesign` signature before installing. That makes signing and notarization load-bearing on this path specifically. It is also the reason the MDM path can ship unsigned and the no-MDM path cannot: the MDM is the trust anchor in one case, the signature is the trust anchor in the other. There is no third option where an unsigned artifact self-updates safely.

Air-gapped tenants set `updateFeedUrl` in their tenant file (§3) and point at their own mirror. Same bytes, same signature, so the mirror is a copy operation and never a build.

### Rollout control

`shellChannel`, `pinnedVersion` and `updateFeedUrl` are new `AppConfig` fields that phase 7 adds; they come from the tenant file like everything else in §3. The dividing line: anything that must change **without** a rebuild belongs in `latest.yml` or the server, never in the tenant file.

- `shellChannel` in the tenant file maps to an `electron-updater` channel (`stable` / `canary`).
- `stagingPercentage` in `latest.yml` for staged rollout, so a bad shell build cannot reach every org at once.
- `pinnedVersion` lets a regulated org hold back deliberately. Changing it is a rebuild, which is acceptable: pinning is a deliberate, rare act.
- `minShellVersion` is the security backstop. Without MDM there is no way to force an update, so the client blocks below the floor with a single mandatory "Restart to update" modal — the only case permitted to interrupt. Enforce the same floor server-side, since a client-side check is bypassable; the backend rejects below-floor clients with an error the app renders as the same modal.

### Windows: nsis updates, msi does not

`build.prod.json` ships both. `nsis.perMachine` is `false`, so a per-user install can self-update with no elevation — keep it that way. `msi.perMachine` is `true`, which cannot self-update without admin rights. Split the roles: **nsis is the self-updating no-MDM artifact; msi is for orgs that do have MDM** and is excluded from the auto-update feed.

### Failure modes that matter in VPN orgs

- Feed unreachable because egress is blocked: retry with backoff, never block app use, surface state in the About panel.
- Download succeeds, install fails: fall back to a "download installer" link rather than a silent retry loop.
- Tenant config fetch fails: run from the cached copy, and treat a signature failure as fatal rather than falling back to cache.

## 6. User experience

**First run, once:**

1. Branded link `https://acme.spaces.xyne.net/download/mac` → 302 to the channel artifact. Per-domain URLs are redirects, never hosts.
2. Install, launch.
3. Run the existing enrollment to obtain the client certificate. The internal build already knows its hostnames and its CA (§3), so there is no workspace to choose and no config to fetch — the shortest possible first run.
4. Community channel only: the user types a workspace URL, as in Slack.

Scripted installs without MDM can pre-seed the enrollment code by dropping `enroll.json` into `/Library/Application Support/Xyne/` or `%ProgramData%\Xyne\`, which carries no trust material and so needs no signature of its own.

**Steady state, invisible:**

- Launch: refresh config, check UI, check shell.
- Shell update: download in background, subtle tray indicator, install on quit. No modal.
- UI update: existing staged + apply-on-blur.
- Below `minShellVersion`: the one blocking modal.
- About panel shows shell version, UI version, tenant (`TENANT_NAME` from §3, `null` for a default build), channel, last update check, plus a manual "Check for updates". Support calls need this, and the tenant name is how support confirms which build an org is actually running.

## 7. Release pipeline

No Electron job exists in `.github/workflows/` today, so every artifact is built on a laptop. Fixing that is independent of signing and comes first.

### 7.1 `pkg` is MDM-only and is never notarized

The two macOS artifacts have disjoint jobs and must not be conflated:

| Artifact | Path | Signed? | Notarized? |
|---|---|---|---|
| `pkg` | MDM push only | no | **no, ever** |
| `dmg` | no-MDM human download | Developer ID Application | yes |
| `zip` | no-MDM `electron-updater` feed | Developer ID Application | yes |

This is a deliberate decision, and it is what makes phase 2 affordable. Notarizing a `pkg` would require a **Developer ID Installer** certificate — a different certificate from the Developer ID Application one — on top of signing every nested executable. By keeping `pkg` on the MDM path where Gatekeeper's quarantine check never runs, that certificate is never needed and the installer-signing layer disappears from the pipeline entirely.

What phase 2 still requires, because it applies to the `.app` inside the `dmg` and `zip`:

- Developer ID **Application** signing of the Electron Framework, all four helper apps, and `native/mic-monitor/mic-monitor`, with hardened runtime. `build.prod.json` already sets `hardenedRuntime: true`, inert today and load-bearing once a real signature exists.
- `mic-monitor` is currently `adhoc, linker-signed` — clang's linker ad-hoc signs it, which is why it runs on Apple Silicon with no Developer ID. Ad-hoc is sufficient for the MDM path and insufficient for notarization, so it needs re-signing in phase 2 only.
- `notarytool` submission of the `dmg` and `zip`, then stapling.

**`build.prod.json` change required:** `mac.target` is currently `pkg` + `zip` only. `dmg` has a config block but no target entry, so no `dmg` is produced. Add it for the no-MDM download; `zip` is already there and is what `electron-updater` needs on macOS.

### 7.2 Phase 1 — unsigned MDM pipeline (no secrets) — implemented

Built on the existing Jenkins + Makefile split rather than a new GitHub Actions
workflow, so it matches how every other module in this repo is released.

**Public repo** holds all build logic, because none of it is deployment-specific:

| Target | Does |
|---|---|
| `electron-deps` | host install of the electron workspace (macOS build only) |
| `electron-tenant` | bake `ELECTRON_TENANT`'s config in, or clear any previous selection (§3) |
| `electron-ui-copy` | stage an already-built `apps/dashboard/dist` into `ui-active` |
| `electron-ui` | build the dashboard first, then stage it (local use) |
| `electron-build-linux` | deb + rpm + AppImage, via buildx |
| `electron-build-win` | nsis + msi + portable, via buildx |
| `electron-build-mac` | pkg + dmg + zip; refuses to run off a Darwin host |
| `electron-artifacts` | checksum and list whatever was produced |
| `electron-version` | optional CI version stamp; no-op when unset |

Artifacts always land in `out/electron/<platform>/`, which `.gitignore` already covers.

`apps/electron/Dockerfile.build` drives the Linux and Windows builds. It uses
buildx with a `scratch` output stage rather than `docker run -v`, because the CI
agents talk to a **remote** Docker daemon: a bind mount would resolve on the dind
pod, not on the agent, and nothing would come back. `apps/dashboard/Dockerfile`
exposes its bundle the same way. Its ignore list is
`apps/electron/Dockerfile.build.dockerignore` — mandatory, because the root
`.dockerignore` excludes both `apps/electron` and every `dist/`. It is deny-all
then re-include, which keeps the context at ~7MB / 144 files.

**Private repo** holds only what must stay private: the `BUILD_ELECTRON`,
`BUILD_ELECTRON_MAC` and `ELECTRON_TENANT` parameters, the stage toggles,
`ELECTRON_MAC_AGENT_LABEL`, the tenant files and CA roots themselves (§3),
and — from phase 2 — credentials. The stage runs after `Build All Modules` and
reuses the dashboard bundle that stage produced, because that build carries
deployment-specific `VITE_*` variables; rebuilding inside the electron targets
would silently produce a bundle pointed at the wrong backend. The macOS stage
takes that same bundle through a `stash`, since it runs on its own agent.

Two things the pipeline pins so CI output matches a laptop build:

- **`CSC_IDENTITY_AUTO_DISCOVERY=false`**, set in both the Makefile and the
  Dockerfile. The electron-builder config sets no `mac.identity`, so
  electron-builder would otherwise auto-discover any Developer ID in the host
  keychain and silently produce a differently-signed artifact than CI does.
- **`--platform linux/amd64`** on the buildx call. The builder image is
  amd64-only; pinning stops an arm64 workstation from silently switching.
- **`select-tenant.mjs` runs on every build**, including untenanted ones, and
  clears both the generated source and its compiled output. Without that, a
  reused workspace carries the previous tenant's hostnames into a default build
  (§3).

`ELECTRON_TENANT` travels as a `--build-arg`, not a `--secret`: hostnames are
not secret, and the selected name belongs in image history as a record of what
the artifact points at. The tenant *files* are what stay private.

Zero secrets. Signing material has a passthrough already wired
(`ELECTRON_BUILD_SECRETS` → buildx `--secret`, never `--build-arg`, which would
persist it in image history), unused until phase 2.

#### Verification status

| Platform | Status |
|---|---|
| Linux | **verified end-to-end.** 6 installers: deb (amd64, arm64), rpm (x86_64, aarch64), AppImage (x86_64, arm64) |
| macOS | **verified end-to-end.** pkg 203MB, dmg 204MB, zip 203MB + blockmaps; `pkgutil --check-signature` reports "no signature" and the app is `Signature=adhoc`, exactly as intended for the MDM path |
| Windows | **packaging verified, installers unverified.** Electron packaging for x64 and arm64 completes, asar integrity and fuses apply, and the nsis installer `.exe` is produced — then the wine post-steps abort |

The Windows gap is a property of the test host, not the pipeline. **Every**
Windows target needs wine: nsis executes the installer it just produced in order
to generate the uninstaller, portable self-extracts, and msi runs WiX
`candle.exe`. Wine inside an emulated amd64 container on Apple Silicon aborts on
the host's 16KB page size:

```
wine: dlls/ntdll/unix/virtual.c:267: anon_mmap_fixed:
      Assertion `!((UINT_PTR)start & host_page_mask)' failed.
qemu: uncaught target signal 6 (Aborted) - core dumped
```

Narrowing the target list does not help, which is what `ELECTRON_WIN_TARGETS`
documents. Windows artifacts need a **native amd64 host** — which the CI agent
is, so the first Jenkins run with `BUILD_ELECTRON` is what confirms it.

### 7.3 Phase 2 — signed no-MDM pipeline

Added as extra jobs on the same workflow, gated on the secrets being present so phase 1 keeps working without them.

| Secret | For |
|---|---|
| `APPLE_CERT_P12` + password | Developer ID **Application** only — no Installer cert, per §7.1 |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY` | App Store Connect API key for notarytool — preferred over an app-specific password |
| Azure Trusted Signing credentials | Windows; code-signing keys must live in an HSM, so a local `.pfx` is not an option |
| `GPG_PRIVATE_KEY` | apt/yum repository metadata |
| feed bucket credentials | `latest*.yml` + artifact publish, CDN invalidation |

Publishes to the update feed in §5. The MDM artifacts from phase 1 are **not** published to that feed — an unsigned artifact must never be reachable by `electron-updater`.

### 7.4 Cleanup — done

The Linux target list in `build.prod.json` went from seven to three (deb, rpm,
AppImage). This was not cosmetic: `flatpak` needs `flatpak-builder` and `snap`
needs `snapcraft`, neither of which is in the builder image, so the Linux build
failed outright on `spawn flatpak ENOENT` until they were removed. The orphaned
`snap`, `flatpak`, and `pacman` config blocks went with them.

Also removed: a duplicated `electronFuses` key in `build.sbx.json`. Both copies
were identical so last-wins made it harmless, but a shadowed security-fuse block
is not something to leave sitting in a config.

Still open, deliberately not changed: `artifactName` is
`${productName}-${version}-${os}-${arch}.${ext}` and `productName` is
`Xyne Spaces`, so every installer filename contains a space
(`Xyne Spaces-1.0.59-mac-universal.pkg`). Tooling here handles it, but it is a
papercut for download URLs and for `latest.yml` in phase 2. Left alone because
the MDM team's packaging may key off the current names — worth a deliberate
decision before phase 2.

## 8. Per-store notes, community channel

| Store | Shape | Notes |
|---|---|---|
| App Store (iOS + macOS) | one listing | needs a working public demo workspace for review; sandbox forbids trust-store writes |
| Play | one listing, AAB | skip Managed Google Play — that is the MDM route |
| Microsoft Store | MSIX | Microsoft signs and owns updates; self-update off |
| brew | own tap `xyne/homebrew-tap` | cask with `auto_updates true`, since `electron-updater` handles it |
| apt / yum | own repo | GPG-signed metadata, no review |

`ui-updater.ts` survives App Store review as long as the payload stays web assets and never native code — the existing `ReleaseConfig.package.index.checksum` is the right guard. Shipping a native binary down that pipe is a rejection.

brew and apt have no guideline 4.3 equivalent, so they *could* carry per-domain builds. They should not; one code path is the entire win.

## 9. Build matrix after

One build per channel per platform. Signing and target list differ by delivery path, the compiled code does not.

| Channel / path | macOS | Windows | Linux |
|---|---|---|---|
| community | store build (universal) | MSIX | deb · rpm · AppImage |
| internal — MDM | `pkg` universal, unsigned | `msi` x64 | deb · rpm |
| internal — no-MDM | `dmg` + `zip` universal, notarized | `nsis` x64 + arm64, signed | deb · rpm · AppImage, GPG repo |

Per channel the cost is fixed. For the internal channel a new merchant is one JSON file in the private repo, one CA cert, a DNS record, and **one pipeline run with `ELECTRON_TENANT=<domain>`** — no source change, no new build config, no code review per customer. For the community channel a new tenant costs nothing at all: same artifact, different URL typed by the user.

White-label with a distinct name and icon in Finder remains a genuine separate build, because bundle identity sits inside the code signature. Apple's route for that is publication from the client's own App Store Connect organisation. Sell it as a tier; never make it the default.

## 10. Migration plan

Ordered so that each step ships alone and nothing early depends on a signing secret.

1. **Unsigned MDM pipeline (§7.2) — done.** Reproduces today's hand-built artifacts in CI. No secrets, no signing. Linux and macOS verified end-to-end; Windows needs a native amd64 agent to confirm. Removes the laptop from the release path.
2. **Build-time tenant selection (§3) — done.** `ELECTRON_TENANT` parameter, tenant files in the private overlay, `CA_CERT_FILE` replacing the CA-filename branch in `mtls.ts`. A new domain stops being a commit to shared source. Untenanted builds are unchanged, so this ships without touching the live MDM artifact.
3. **Add the real tenant files.** Private repo only: one `tenants/<domain>.json` and one `certs/ca.<domain>.cert` per live deployment, then a pipeline run per domain. No public change.
4. **Version floor (§5, layer 3).** `minShellVersion` enforced server-side, rendered client-side as the one permitted blocking modal. Benefits MDM orgs immediately, since a server-side floor is how an un-updated fleet gets caught regardless of delivery path.
5. **Community channel.** Compile out `installRootCA`, compile out self-update, public TLS only, platform attestation for device identity (App Attest / Play Integrity / TPM-bound key). The real work, and independently reviewable.
6. **Runtime tenant config — community channel only.** Workspace URL typed by the user, hostnames resolved over public TLS. No signing layer, because the document carries no trust material (§4).
7. **Signed no-MDM pipeline (§7.3), then `electron-updater`.** Only now does the signing cost get paid, and only for the path that needs it. Scope is Developer ID Application signing plus notarization of `dmg` and `zip`; `pkg` stays unsigned and MDM-only, so no installer certificate is involved.
8. **Submit one listing per store.** Sandbox becomes a tenant of the community channel, and `build.sbx.json` is deleted.

Steps 1–4 are worth doing even if the store work never happens.

**Blocked on decisions, not code:**

| Blocker | Blocks | Nature |
|---|---|---|
| macOS build agent (`ELECTRON_MAC_AGENT_LABEL = 'xyne-macos'`, none exists) | `BUILD_ELECTRON_MAC`, and all of step 7 | procurement — own a Mac, rent one, or accept a GitHub Actions hybrid |
| Developer ID Application cert + Azure Trusted Signing (HSM-backed since 2023; no local `.pfx`) | step 7 | procurement |
| Apple / Play / Microsoft developer accounts, plus a public demo workspace for review | step 8 | procurement, and an org-level decision |
| Device identity mechanism for the community channel | step 5 scope | design |

Lens check: channel owns what changes at the rate of a compliance boundary (trust root, bundle identity, update ownership); tenant owns what changes at the rate of a sales contract (hostnames, branding, flags); release owns what changes weekly (shell version); UI owns what changes daily. Nothing that changes at one rate is stored in a layer that updates at another.
