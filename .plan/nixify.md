# Nix roadmap for xyne-spaces

Updated 2026-10-01 for Phase 0 in PR #2597. Supersedes the earlier
Nammayatri-modeled plan, which predates the `apps/` restructure.

## Goal

One dev stack for humans and agents: Nix via `flake.nix` + `project.nix`
(flake-parts, process-compose-flake, services-flake). The dev shell is the only
toolchain, `nix run .#xyne-space-services` covers every dev feature, CI runs the
same commands developers run, and every Compose file is deleted.

Out of scope: production deployment (`deployment/`, `helm-charts/`,
`claw-deployments/`). Image builds (`Makefile` targets, `build-images.yml`,
`publish-images.yml`) stay as they are until the optional Phase 7.

## Migration rule

**Compose is deleted incrementally, never at the end.** A Compose service, script
or file is removed in the same PR that lands its Nix replacement. There is no
final deletion phase, so nothing waits around going stale while phases merge over
months. Two mechanisms enforce this:

1. A CI gate that fails on `docker compose` / `docker-compose` references outside
   `deployment/` and `helm-charts/`, with an allowlist file listing today's
   references. Every migration PR shrinks the allowlist; no PR may grow it.
2. `docker-compose.test.yml` is self-contained, so `dev.yml` can be dismantled
   service by service without breaking e2e before e2e itself migrates.

## Where we are

**Nix has:** dev shell (node, pnpm, just, openssl, pinned Prisma engines);
services bundle (Postgres, Redis, LiveKit, Zero, fake GCS, Y-Sweet, transcription
agent, db-setup); `nix-ci.yml` with a runtime smoke test; `vira.hs`. Flake
`checks` cover referenced paths, script tests, Compose references, and Playwright versions. The Kata
Claw sandboxes already run the bundle.

**Docker still owns:**

| Compose file | Started by |
| --- | --- |
| `docker-compose.dev.yml` | `pnpm run services` (`select-services.mjs` → `start-services.sh`), `apps/backend` ysweet scripts, `watch-transcription-agent.sh` |
| `docker-compose.test.yml` (standalone; no `dev.yml` layering) | `ci.yml` `test` job, `tools/xyne-automation` runner, `run-cucumber-local.sh`, `xyne-automation-old`; builds `apps/*/Dockerfile.test` |
| `docker-compose.sandbox.yml` + `scripts/sandbox.sh` | Multi-sandbox with traefik |
| `vespa-core/deployment/docker-compose.dev.yml` | `start-services.sh` when search is selected |

Docs and agents still default to Docker: README Quickstart, `docs/setup/prerequisites.md`,
`guidelines/AGENTS.md` (stale paths too), `.husky/pre-commit` (brew gitleaks),
`.husky/post-commit` (Compose tests). `.mcp.json` needs a `dist/` that `just prepare`
never builds.

**Main CI is not on Nix.** `ci.yml`, `schema-migration-check.yml`,
`helm-charts-ci.yml` use setup-node, pnpm/action-setup, curl-installed gitleaks
and Trivy, and a `RUNNER_OS` switch for the mixed self-hosted runners.

Phase 0 removed runtime tool/dependency downloads and pins the development toolchain.

**nixpkgs has:** rustfs, victoriametrics, victorialogs, grafana,
opentelemetry-collector-contrib, fluent-bit, gauge, playwright-driver.browsers.
**Lacks:** y-sweet, Vespa server, Superposition, livekit-egress.

## Roadmap

**Phase 0 landed ([PR #2597](https://github.com/juspay/xyne-spaces/pull/2597)):**
Juspay Y-Sweet, workspace Zero, uv2nix transcription, runtime secrets, pinned
toolchain, flake checks, Compose gate, first deletions, and standalone test Compose.

Phases 1 to 5 are independent slices; each lands its Nix piece and deletes the Compose piece it
replaces. Phase 2 (main CI) should land before Phase 4 (e2e) so Nix is proven on
cheap jobs first.

### Phase 0: purity, gate, and the first deletions (complete)

- [x] Build Y-Sweet in `nix/packages.nix` from `github:juspay/y-sweet` at `221d5af`;
      remove curl and runtime cache plumbing; keep `.nix-cache/` ignored for existing checkouts.
- [x] Pin PostgreSQL server and clients to 17 for existing developer data directories.
- [x] Zero: use the module's `nodeModulesPath` against `apps/backend/node_modules`; drop `npx`.
- [x] Transcription agent: uv2nix-built Python 3.11 environment for base requirements;
      no venv or pip at startup. Export Docker requirements from the lock; diarization stays separate.
- [x] Verify `ZERO_AUTH_SECRET` was empty under pure evaluation; read `.env.local` at runtime.
- [x] Use `nodejs_22`; pin pnpm to 10.15.0 via a nixpkgs overlay in `flake.nix`, matching
      `packageManager`. The pnpm 12 migration is a separate PR covering `ci.yml` flags,
      all app Dockerfiles, and moving settings to `pnpm-workspace.yaml`.
- [x] Add to shell: ffmpeg, gitleaks, trivy, postgresql, process-compose, helm, gauge,
      Nix Playwright browsers aligned with npm pins, download-skip variables; prepend Linux C++/zlib library paths.
- [x] Flake `checks`: referenced-paths, the secrets/proxy script tests, compose-refs, and playwright-version.
      Git-history-dependent schema/SQL/enum/tenant guards remain outside these checks.
- [x] **Gate:** check Compose references against the allowlist through `nix flake check` in CI.
- [x] **Delete:** `docker-compose.local.yml`, `docker/Dockerfile.dev-infra`, `docker/dev-infra/`,
      `docker/Dockerfile.call-services`, and `docker/entrypoint.sh`. Move `otel-collector-config.yaml`
      to `docker/`; keep `docker/livekit.yaml`. Repoint `services:stop` to `just cleanup-ports`.
- [x] **Delete:** `scripts/start-services-win.sh`, `services:win`, root `setup.sh`, its caller
      `clone-and-setup.sh`, and `just setup`; Windows docs point to WSL2 + Nix.
- [x] Make `docker-compose.test.yml` standalone with equivalent resolved configuration;
      update the four callers and detect the repo root by `pnpm-workspace.yaml`.

### Phase 1: dev infra, one feature slice at a time

Each slice is one PR: add the Nix processes, add them to the smoke test, remove
the same services from `docker-compose.dev.yml` and the feature from
`select-services.mjs`, shrink the allowlist. Suggested order:

- [ ] **Core** (Postgres, Redis, Zero, Y-Sweet, fake GCS): already in Nix. Remove them from
      `dev.yml`; `pnpm run services` core path becomes `nix run .#xyne-space-services`.
      Move `apps/backend` ysweet scripts and `watch-transcription-agent.sh` to process-compose.
      `docker-compose.test.yml` is standalone, so `dev.yml` can shrink freely.
      Decide the Postgres major for dev (16 in Compose, 17 in Nix) and align them.
- [ ] **Storage**: rustfs in Nix; remove the `minio` service.
- [ ] **Calls**: LiveKit already in Nix; egress via `nix/containers` or from source; remove `livekit`, `livekit-egress`.
- [ ] **Search**: Vespa via `nix/containers` (spike on Linux and macOS first); delete
      `vespa-core/deployment/docker-compose.dev.yml` and `vespa-core/scripts/deploy-dev.sh`.
- [ ] **Observability**: otel-collector, victoriametrics, victorialogs, fluent-bit, grafana (+ provisioning
      from `docker/`); remove those five services. Or drop the feature if nobody uses it locally.
- [ ] **Flags**: Superposition via `nix/containers`, or drop.
- [ ] Along the way: one source of truth for ports (hardcoded today in `project.nix`,
      smoke test); bundles `core`, `+calls`, `+search`, `+observability`, `+flags` replace the picker;
      `start-services.sh` and `reset-local.sh` behaviour folds into `db-setup`, `apps.cleanup`, `cleanup-all.sh`.
- [ ] When the last service leaves `dev.yml`: **delete** `docker-compose.dev.yml`, `start-services.sh`,
      `select-services.mjs`, the compose branches in `reset-local.sh`, unused `docker/` files, and the
      doc references (`docs/setup/{services,troubleshooting}.md`, `apps/backend/docs/METRICS.md`,
      `vespa-core/vespa/docker/services.xml`, `docs/superpowers/specs/2026-08-06-*.md`, `apps/backend/src/vespa/*` comments).

### Phase 2: main CI on the dev shell

- [ ] Justfile recipes per CI leg so local == CI.
- [ ] `ci.yml`, `schema-migration-check.yml`, `helm-charts-ci.yml` run `nix develop -c just <recipe>`
      using the installer and cache steps from `nix-ci.yml`. Delete setup-node, pnpm action, curl installs, `RUNNER_OS` switch.
- [ ] Confirm self-hosted runners have Nix. Gate for Phase 4.
- [ ] Replace or **delete** `Dockerfile.ci`.

### Phase 3: Nix is the default for developers and agents

Can start as soon as the Phase 1 core slice lands.

- [ ] `pnpm run up` → `just up`; `xyne-doctor` keeps diagnostics, drops container-runtime checks.
- [ ] README and `docs/setup/*` put Nix first; drop OrbStack, Docker Desktop, apt lists.
- [ ] Rewrite `guidelines/AGENTS.md`; add root `AGENTS.md` (symlink `CLAUDE.md`).
- [ ] `just prepare` builds the two MCP packages so `.mcp.json` works fresh.
- [ ] Husky hooks run via `direnv exec`; drop the brew hint; post-commit uses the Phase 4 path or skips.
- [ ] Update Claw `sandbox-repo-setup` for xyne-spaces (runs `npm run services`).

### Phase 4: e2e on Nix

- [ ] Automation suite runs with process-compose infra, backend/dashboard on the host, runner via `nix develop`.
      Fallback: `dockerTools` test images without Compose.
- [ ] Port `tools/xyne-automation/scripts/runner/index.ts` (repo-root detection now uses `pnpm-workspace.yaml`),
      `collect-ci-artifacts.sh`, `download-visual-regression-assets.sh`, `run-cucumber-local.sh`. Logs from `.logs/`.
- [ ] Run both paths in `ci.yml` until Nix is green for two weeks.
- [ ] Then **delete** `docker-compose.test.yml`, both `Dockerfile.test`, the Compose path in the runner,
      `tools/xyne-automation-old` (or migrate it), and the references in both `.env.test` and
      `tests/03_e2e/08_calls/01_channel-calls.spec`.

### Phase 5: multi-sandbox on Nix

- [ ] `scripts/sandbox.sh` on process-compose: per-sandbox port offset and state dir (needs Phase 1 ports).
- [ ] Shared infra and monitoring as their own bundle. Traefik as a Nix process or replaced.
- [ ] Then **delete** `docker-compose.sandbox.yml` and the kata template comment; allowlist reaches zero; delete the allowlist.

### Phase 6 (optional): build the apps with Nix

`packages.backend`/`packages.dashboard` via `pnpm.fetchDeps`, typecheck and lint as
`checks`, so `nix flake check` or Vira can be the whole CI. Costs: a hash bump on
every lockfile change across 25 workspace members, `--ignore-scripts` for gauge and
Playwright, 8 GB heap builds in the sandbox. Decide after Phase 5.

### Phase 7 (optional, needs Phase 6): deployment images built with Nix

Today no production Dockerfile uses the flake. All Node images are
`node:22.22.3-slim` + `pnpm build`; the Python images are `python:3.11-slim` +
`pip`. `apps/backend/Docker.runner` installs upstream Nix with curl at image build
time but does not consume this repo's flake.

- [ ] `dockerTools.buildLayeredImage` per app from the Phase 6 packages; publish
      via `publish-images.yml` (`nix build .#images.<app>` + `skopeo copy`) instead
      of `docker buildx`. Same tags and registry, so Helm and ArgoCD are untouched.
- [ ] Start with `Docker.runner`: it already ships Nix, so replace the curl
      installer, rustup and the nine-minute `diesel_cli` compile with nixpkgs
      packages in the image closure.
- [ ] Python images (transcription agent, lighton-ocr) follow once the uv2nix
      work from Phase 0 exists; they reuse the same Python environment.
- [ ] Retire the per-app Dockerfiles and the `Makefile` `build-*`/`push-*`
      targets one image at a time, same rule as Compose: delete in the PR that
      replaces.
- [ ] Node pin is then enforced by nixpkgs in dev, CI and production alike, so
      the lockstep item in Phase 0 goes away.

Out of scope even here: Helm charts, Terraform, ArgoCD. Only how the image bytes
are produced changes.

## Open questions

1. Do the `ci-cluster-github-runners*` runners have Nix? Gates Phases 2 and 4.
2. Does a Jenkins job still consume `test:push` report branches? No Jenkinsfile is in the repo. If not, delete that machinery in Phase 3.
3. macOS: are Vespa, Superposition, egress acceptable through podman-in-Nix (needs a VM), or served remotely? The search slice's spike answers.
4. Which of observability, Superposition, egress are needed in a dev loop? Drop rather than port.
5. ~~Node/pnpm pin policy~~ Decided: pnpm follows `packageManager` via a Nix override
   until the separate pnpm 12 migration PR; Node follows nixpkgs (`nodejs_22`).

## Done when

- `direnv allow` is the only setup step on every supported platform.
- The Nix stack runs offline after `nix build`; nothing downloads at runtime.
- The bundles cover every dev feature; every GitHub Actions job runs in the dev shell.
- e2e is green on Nix; the Compose allowlist is empty and the gate is still on.
- `nix flake check` runs the guards; `AGENTS.md` and `.mcp.json` work on a fresh checkout.
