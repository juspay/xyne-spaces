# Nix for Xyne Spaces

**One dev stack, for humans and agents.** Today Xyne Spaces has two: Nix and Docker
Compose, and they drift.[^drift] This plan moves everything to Nix, one piece at a time,
until `direnv allow` is the only setup step and every Compose file is gone.

Production deployment is out of scope.[^scope]

## At a glance

Two tracks run side by side. The main track is what developers touch. The CI track
waits on runners that can install Nix, so it shouldn't hold up the main track.

**Main track**

| Phase | What changes | Status |
| --- | --- | --- |
| **0** | Nix stack becomes reproducible; Compose leftovers removed | ✅ [#2597] |
| **1** | One `docker run` for contributors without Nix | Next |
| **2** | Dev services move to Nix; dev Compose deleted | |
| **3** | Docs and agents default to Nix | |
| **4** | Multi-sandbox runs on Nix; sandbox Compose deleted | |

**CI track**

| Step | What changes | Status |
| --- | --- | --- |
| **CI 1** | Nix CI runs on PRs again | Blocked on runners |
| **CI 2** | Main CI runs in the Nix dev shell | |
| **CI 3** | End-to-end tests run on Nix; test Compose deleted | |

Compose is gone when both tracks finish. One link crosses the tracks: Phase 1 needs
CI 1 to build and test its image.

## The one rule

**Delete Compose as we go, never at the end.** Whatever a PR moves to Nix, that same PR
deletes from Compose. A CI gate keeps us honest: it lists every remaining Compose
reference, and the list may only shrink.[^gate]

## Phase 0: make the Nix stack trustworthy ✅

*Nothing downloads at startup anymore, and the toolchain is pinned.*

- Y-Sweet is built from Juspay's fork, not curled at runtime[^ysweet]
- Transcription runs from a locked Python environment, not `pip install`[^python]
- Zero runs from the workspace and reads its secret at runtime[^zero]
- Node 22, pnpm 10.15.0, Postgres 17 pinned; the shell has every tool CI needs[^toolchain]
- `nix flake check` guards paths, tests, Compose references and lockfiles[^checks]
- Dead Compose paths deleted[^phase0-deletes]

## Phase 1: a way in without Nix

*Contributors who can't install Nix get one `docker run`, built from the same Nix
definitions.*

- One image runs the services, backend and dashboard[^image]
- CI runs the smoke test inside it, so it can't drift from the Nix stack
- Needs CI 1, to build, test and publish the image

Nothing leaves Compose until this ships, so nobody loses access.

## Phase 2: move the dev services

*`pnpm run services` gradually becomes `nix run .#xyne-space-services`.*

Each feature is one PR: add it to Nix, delete it from `docker-compose.dev.yml`.[^slice]

1. **Core**: Postgres, Redis, Zero, Y-Sweet, fake GCS (already in Nix)[^core]
2. **Storage**: rustfs[^storage]
3. **Calls**: LiveKit and transcription (already in Nix), egress[^containers]
4. **Search**: Vespa[^containers]
5. **Observability**: or drop it, if nobody uses it locally[^observability]
6. **Feature flags**: Superposition, or drop it[^containers]

When the last service leaves, `docker-compose.dev.yml` and its scripts are deleted.[^phase2-end]

## Phase 3: Nix is the default

*A new developer or agent reads the README and ends up on Nix.*

- README and setup docs lead with Nix[^docs]
- A root `AGENTS.md` that agents load and that points them at Nix[^agents]
- Git hooks and MCP servers work on a fresh checkout[^fresh]

Can start once the Phase 2 Core slice lands.

## Phase 4: multi-sandbox on Nix

*The sandbox stack stops needing Compose.*

- `scripts/sandbox.sh` runs each sandbox on Nix, with its own ports and state[^sandbox]
- `docker-compose.sandbox.yml` deleted

## CI track

*If it passes locally, it passes in CI.* Starts as soon as runners can install Nix.[^runners]

- **CI 1:** `nix-ci.yml` runs on PRs again, so flake checks and the smoke test gate
  every change[^ci1]
- **CI 2:** one `just` recipe per CI job; CI runs `nix develop -c just <recipe>`, and the
  hand-rolled setup steps (setup-node, curl installs, OS switches) go[^ci]
- **CI 3:** tests run against the Nix services, with backend and dashboard on the
  host.[^e2e] Both paths run in CI until Nix is green for two weeks, then
  `docker-compose.test.yml` is deleted[^ci3-deletes]

CI 3 needs CI 2 first, so Nix is proven on cheap CI jobs before expensive ones.

## Beyond this plan

The plan ends when Compose is gone. Two follow-ups could come after, decided then:

- **Build the apps with Nix.** `nix flake check` could become the whole CI, but at a
  real cost.[^build-apps]
- **Build production images with Nix.** Same images, same registry, built by Nix
  instead of Dockerfiles. Helm and ArgoCD don't change.[^build-images]

## Open questions

1. **CI runners:** they block the sudo Nix needs. Bake Nix into the runner image, or
   stay on GitHub-hosted runners? This unblocks the CI track and Phase 1.[^runners]
2. **Unused features:** which of observability, feature flags and call recording does
   anyone run locally? Drop rather than port.
3. **macOS containers:** are Vespa, Superposition and egress acceptable through
   podman in a VM, or should they be served remotely? The Search slice answers this.
4. **Jenkins:** does anything still consume `test:push` report branches? If not,
   delete that machinery in Phase 3.

## Done when

- `direnv allow` is the only setup step, on every supported platform
- Nothing downloads at runtime
- Every dev feature runs on Nix, and every CI job runs in the dev shell
- e2e is green on Nix, and the Compose list is empty with the gate still on
- The root `AGENTS.md` and `.mcp.json` work on a fresh checkout

[#2597]: https://github.com/juspay/xyne-spaces/pull/2597

[^drift]: Examples: Postgres is 16 in Compose and 17 in Nix. `services:stop` used to
    stop `docker-compose.local.yml` while `pnpm run services` started
    `docker-compose.dev.yml`.

[^scope]: `deployment/`, `helm-charts/`, `claw-deployments/` are untouched. Image builds
    (`Makefile` targets, `build-images.yml`, `publish-images.yml`) stay as they are.

[^gate]: `nix/scripts/check-compose-refs.sh` fails on any `docker compose` /
    `docker-compose` reference outside `deployment/` and `helm-charts/` that isn't in
    `nix/compose-refs.allowlist`. `docker-compose.test.yml` is standalone (no `dev.yml`
    layering), so `dev.yml` can shrink without breaking e2e.

[^ysweet]: `nix/packages.nix` builds `github:juspay/y-sweet` at `221d5af` with
    `pkgs.rustPlatform`. `.nix-cache/` stays ignored for existing checkouts.

[^python]: uv2nix builds a Python 3.11 environment from `apps/backend/python-agent/uv.lock`.
    Docker's `requirements.txt` is exported from the same lock. Diarization stays a
    separate Docker opt-in.

[^zero]: The module's `nodeModulesPath` points at `apps/backend/node_modules`; no `npx`.
    Pure evaluation was producing `ZERO_AUTH_SECRET=''`, so `.env.local` is now read at
    runtime.

[^toolchain]: `nodejs_22`; pnpm pinned to 10.15.0 by an overlay in `flake.nix` to match
    `packageManager` (the pnpm 12 migration is a separate PR). Postgres 17 keeps existing
    developer data directories. The shell adds ffmpeg, gitleaks, trivy, process-compose,
    helm, gauge, and Playwright browsers matched to the npm pins (1.63.0).

[^checks]: `referenced-paths`, `script-tests`, `compose-refs`, `playwright-version`,
    `python-agent-lock`. Guards that need git history (schema, SQL, enum, tenant) stay
    outside. Until CI 1, run `nix flake check` locally.

[^phase0-deletes]: `docker-compose.local.yml`, `docker/Dockerfile.dev-infra`,
    `docker/dev-infra/`, `docker/Dockerfile.call-services`, `docker/entrypoint.sh`,
    `setup.sh`, `clone-and-setup.sh`, `just setup`. Windows docs offer WSL2 with
    either Nix or Docker; native `services:win` stays until Phase 2 ends.
    `services:stop` runs `start-services.sh --stop`: Compose `down` if that stack is
    running, otherwise Nix port cleanup.

[^image]: Usage: `docker run -v "$PWD":/src -p 3000:3000 -p 3001:3001
    ghcr.io/juspay/xyne-spaces-dev`. Built with `dockerTools` from the same definitions.
    It runs backend and dashboard too, since these users have no Node on the host.
    Needs: services bind `0.0.0.0` (today they bind 127.0.0.1), a `full` bundle, x86_64
    and arm64 images published to GHCR. Search, call recording and feature flags stay
    out (they're containers themselves).

[^slice]: Each slice also adds the service to the smoke test, removes the feature from
    `select-services.mjs`, and shrinks the allowlist. Along the way: one source of truth
    for ports, and bundles (`core`, `+calls`, `+search`, …) replace the interactive picker.

[^core]: Also: move the `apps/backend` Y-Sweet scripts and `watch-transcription-agent.sh`
    to process-compose, and settle on one Postgres major for dev (16 vs 17).

[^storage]: Compose's `minio` service already runs the `rustfs/rustfs` image, and rustfs
    is in nixpkgs. The backend only uses it when `S3_ENDPOINT` is set.

[^containers]: Not in nixpkgs (only `vespa-cli` is), so these run through
    `nix/containers` (podman). Vespa needs a spike on Linux and macOS first. Egress
    could also be built from source.

[^observability]: otel-collector, victoriametrics, victorialogs, fluent-bit and grafana are
    all in nixpkgs. Grafana provisioning comes from `docker/`.

[^phase2-end]: Deleted: `docker-compose.dev.yml`, `start-services.sh`,
    `start-services-win.sh` and `services:win`, `select-services.mjs`,
    the Compose branches in `reset-local.sh`, unused `docker/` files, the Vespa dev
    compose file and `deploy-dev.sh`, and doc references (`docs/setup/services.md`,
    `troubleshooting.md`, `apps/backend/docs/METRICS.md`, …).

[^docs]: Drop OrbStack, Docker Desktop and apt lists; non-Nix setups point to the
    Phase 1 image. `pnpm run up` becomes `just up`; `xyne-doctor` keeps its diagnostics
    but drops container-runtime checks. Claw's `sandbox-repo-setup` is updated too.

[^agents]: Today the only one is `guidelines/AGENTS.md`. Agents don't pick it up from
    there, its paths predate the `apps/` restructure (`backend/`, `dashboard/`), and it
    says "Docker compose: `npm run services`".

[^fresh]: Husky hooks run through `direnv exec` (no brew hint). `just prepare` builds the two
    MCP packages that `.mcp.json` needs.

[^sandbox]: Per-sandbox port offset and state directory (needs Phase 2's single source of
    ports). Shared infra and monitoring become their own bundle; Traefik becomes a Nix
    process or is replaced.

[^runners]: `nix-ci.yml` targets `ubuntu-latest`, but its PR and push triggers have been
    commented out since #3047: the installer needs sudo, which the self-hosted
    `ci-cluster-github-runners*` pods block (`allowPrivilegeEscalation: false`).

[^ci1]: Uncomment the `pull_request` and `push` triggers in `nix-ci.yml` once a runner can
    install Nix. It already runs `nix flake check`, the builds, `just prepare`, the
    script tests and the smoke test.

[^ci]: Covers `ci.yml`, `schema-migration-check.yml`, `helm-charts-ci.yml`, using the
    installer and cache steps from `nix-ci.yml`. `Dockerfile.ci` is replaced or deleted.

[^e2e]: The runner runs via `nix develop`. Ports: `tools/xyne-automation/scripts/runner/index.ts`,
    `collect-ci-artifacts.sh`, `download-visual-regression-assets.sh`,
    `run-cucumber-local.sh`. Fallback if needed: `dockerTools` test images without Compose.

[^ci3-deletes]: Also both `Dockerfile.test`, the runner's Compose path,
    `tools/xyne-automation-old` (or migrate it), and references in both `.env.test` files
    and `tests/03_e2e/08_calls/01_channel-calls.spec`.

[^build-apps]: `packages.backend` / `packages.dashboard` via `pnpm.fetchDeps`, with typecheck
    and lint as flake checks. Costs: a hash bump on every lockfile change across 25
    workspace members, `--ignore-scripts` for gauge and Playwright, 8 GB heap builds in
    the sandbox.

[^build-images]: Needs the apps built with Nix first. `dockerTools.buildLayeredImage` per
    app, published with `skopeo` from `publish-images.yml` under the same tags. Start
    with `Docker.runner`, which already ships Nix: swap its curl installer, rustup and
    nine-minute `diesel_cli` compile for nixpkgs packages. Python images reuse the
    Phase 0 uv2nix environment. Dockerfiles and `Makefile` build targets retire one at
    a time.
