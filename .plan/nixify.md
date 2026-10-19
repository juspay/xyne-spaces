# Nix for Xyne Spaces

**One dev stack, for humans and agents.** Today Xyne Spaces has two: Nix and Docker
Compose, and they drift.[^drift] This plan moves everything to Nix, one piece at a time,
until `direnv allow` is the only setup step and every Compose file is gone.

Production deployment is out of scope.[^scope]

## At a glance

| Phase | What changes | Status |
| --- | --- | --- |
| **0** | Nix stack becomes reproducible; Compose leftovers removed | ✅ [#2597] |
| **1** | Dev services move from Compose to Nix, one feature at a time | Next |
| **2** | Main CI runs in the Nix dev shell | |
| **3** | Docs and agents default to Nix | |
| **4** | End-to-end tests run on Nix | |
| **5** | Multi-sandbox runs on Nix; last Compose file deleted | |
| 6 | *Optional:* apps themselves built with Nix | |
| 7 | *Optional:* production images built with Nix | |

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

## Phase 1: move the dev services

*`pnpm run services` gradually becomes `nix run .#xyne-space-services`.*

Each feature is one PR: add it to Nix, delete it from `docker-compose.dev.yml`.[^slice]

1. **A way in without Nix**: one `docker run`, built from the Nix stack, for
   contributors who can't install Nix. Lands first, so nobody loses access.[^image]
2. **Core**: Postgres, Redis, Zero, Y-Sweet, fake GCS (already in Nix)[^core]
3. **Storage**: MinIO → rustfs
4. **Calls**: LiveKit (already in Nix) and egress[^containers]
5. **Search**: Vespa[^containers]
6. **Observability**: or drop it, if nobody uses it locally[^observability]
7. **Feature flags**: Superposition, or drop it[^containers]

When the last service leaves, `docker-compose.dev.yml` and its scripts are deleted.[^phase1-end]

## Phase 2: CI uses the same commands as developers

*If it passes locally, it passes in CI.*

- One `just` recipe per CI job; CI runs `nix develop -c just <recipe>`[^ci]
- Hand-rolled setup steps (setup-node, curl installs, OS switches) deleted
- Blocked on runners: they can't install Nix today[^runners]

## Phase 3: Nix is the default

*A new developer or agent reads the README and ends up on Nix.*

- README and setup docs lead with Nix[^docs]
- `AGENTS.md` rewritten for agents
- Git hooks and MCP servers work on a fresh checkout[^fresh]

Can start once the Phase 1 Core slice lands.

## Phase 4: end-to-end tests on Nix

*The automation suite stops needing Compose.*

- Tests run against the Nix services, with backend and dashboard on the host[^e2e]
- Both paths run in CI until Nix is green for two weeks
- Then `docker-compose.test.yml` is deleted[^phase4-deletes]

Needs Phase 2 first, so Nix is proven on cheap CI jobs before expensive ones.

## Phase 5: multi-sandbox on Nix

*The last Compose file goes.*

- `scripts/sandbox.sh` runs each sandbox on Nix, with its own ports and state[^sandbox]
- `docker-compose.sandbox.yml` deleted; the gate's list reaches zero

## Phase 6 (optional): build the apps with Nix

*`nix flake check` could become the whole CI.* Real costs, so decide after Phase 5.[^phase6]

## Phase 7 (optional): build production images with Nix

*Same images, same registry, built by Nix instead of Dockerfiles.* Helm and ArgoCD
don't change.[^phase7]

## Open questions

1. **CI runners:** they block the sudo Nix needs. Bake Nix into the runner image, or
   stay on GitHub-hosted runners?[^runners]
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
- `AGENTS.md` and `.mcp.json` work on a fresh checkout

[#2597]: https://github.com/juspay/xyne-spaces/pull/2597

[^drift]: Examples: Postgres is 16 in Compose and 17 in Nix. `services:stop` used to
    stop `docker-compose.local.yml` while `pnpm run services` started
    `docker-compose.dev.yml`.

[^scope]: `deployment/`, `helm-charts/`, `claw-deployments/` are untouched. Image builds
    (`Makefile` targets, `build-images.yml`, `publish-images.yml`) stay as they are
    unless Phase 7 happens.

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
    outside. `nix-ci.yml` runs these, but is manual-only since main's 6a08a6a9b (#3047).

[^phase0-deletes]: `docker-compose.local.yml`, `docker/Dockerfile.dev-infra`,
    `docker/dev-infra/`, `docker/Dockerfile.call-services`, `docker/entrypoint.sh`,
    `setup.sh`, `clone-and-setup.sh`, `just setup`. Windows docs offer WSL2 with
    either Nix or Docker; native `services:win` stays until Phase 1. `services:stop` now runs
    `start-services.sh --stop`: Compose `down` if that stack is running, otherwise Nix
    port cleanup.

[^slice]: Each slice also adds the service to the smoke test, removes the feature from
    `select-services.mjs`, and shrinks the allowlist. Along the way: one source of truth
    for ports, and bundles (`core`, `+calls`, `+search`, …) replace the interactive picker.

[^image]: Usage: `docker run -v "$PWD":/src -p 3000:3000 -p 3001:3001
    ghcr.io/juspay/xyne-spaces-dev`. Built with `dockerTools` from the same definitions;
    CI runs the smoke test inside it, so it can't drift. It runs backend and dashboard
    too, since these users have no Node on the host. Needs: services bind `0.0.0.0`, a
    `full` bundle, x86_64 and arm64 images published to GHCR. Search, call recording and
    feature flags stay out (they're containers themselves).

[^core]: Also: move the `apps/backend` Y-Sweet scripts and `watch-transcription-agent.sh`
    to process-compose, and settle on one Postgres major for dev (16 vs 17).

[^containers]: Not in nixpkgs, so these run through `nix/containers` (podman). Vespa needs a
    spike on Linux and macOS first. Egress could also be built from source.

[^observability]: otel-collector, victoriametrics, victorialogs, fluent-bit and grafana are
    all in nixpkgs. Grafana provisioning comes from `docker/`.

[^phase1-end]: Deleted: `docker-compose.dev.yml`, `start-services.sh`,
    `start-services-win.sh` and `services:win`, `select-services.mjs`,
    the Compose branches in `reset-local.sh`, unused `docker/` files, the Vespa dev
    compose file and `deploy-dev.sh`, and doc references (`docs/setup/services.md`,
    `troubleshooting.md`, `apps/backend/docs/METRICS.md`, …).

[^ci]: Covers `ci.yml`, `schema-migration-check.yml`, `helm-charts-ci.yml`, using the
    installer and cache steps from `nix-ci.yml`. `Dockerfile.ci` is replaced or deleted.

[^runners]: The `ci-cluster-github-runners*` pods set `allowPrivilegeEscalation: false`, so
    a per-job Nix install fails. That's why #3047 turned off Nix CI's PR triggers.

[^docs]: Drop OrbStack, Docker Desktop and apt lists. `pnpm run up` becomes `just up`;
    `xyne-doctor` keeps its diagnostics but drops container-runtime checks. Claw's
    `sandbox-repo-setup` is updated too.

[^fresh]: Husky hooks run through `direnv exec` (no brew hint). `just prepare` builds the two
    MCP packages that `.mcp.json` needs.

[^e2e]: The runner runs via `nix develop`. Ports: `tools/xyne-automation/scripts/runner/index.ts`,
    `collect-ci-artifacts.sh`, `download-visual-regression-assets.sh`,
    `run-cucumber-local.sh`. Fallback if needed: `dockerTools` test images without Compose.

[^phase4-deletes]: Also both `Dockerfile.test`, the runner's Compose path,
    `tools/xyne-automation-old` (or migrate it), and references in both `.env.test` files
    and `tests/03_e2e/08_calls/01_channel-calls.spec`.

[^sandbox]: Per-sandbox port offset and state directory (needs Phase 1's single source of
    ports). Shared infra and monitoring become their own bundle; Traefik becomes a Nix
    process or is replaced.

[^phase6]: `packages.backend` / `packages.dashboard` via `pnpm.fetchDeps`, with typecheck and
    lint as flake checks. Costs: a hash bump on every lockfile change across 25 workspace
    members, `--ignore-scripts` for gauge and Playwright, 8 GB heap builds in the sandbox.

[^phase7]: Needs Phase 6. `dockerTools.buildLayeredImage` per app, published with `skopeo`
    from `publish-images.yml` under the same tags. Start with `Docker.runner`, which
    already ships Nix: swap its curl installer, rustup and nine-minute `diesel_cli`
    compile for nixpkgs packages. Python images reuse the Phase 0 uv2nix environment.
    Dockerfiles and `Makefile` build targets retire one at a time.
