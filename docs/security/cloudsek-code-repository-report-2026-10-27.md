# CloudSEK report (27 Oct 2026) — `juspay/xyne-spaces` findings triage

Source: CloudSEK XVigil event report, incidents XVA-26055902 / 26055899 / 26055898 / 26055897 / 26055896 / 3073763. Triaged 28 Oct 2026 against `main` @ `6aa9e5a47`.

| # | Report category | Reported value | Where in repo | Verdict | Reason / Fix |
|---|---|---|---|---|---|
| 1 | Repository | `juspay/xyne-spaces` is public | GitHub | **TP** | Accurate. Team decision whether to keep it public. Not a code fix. |
| 2 | Internal subdomain | `bitbot.internal.svc.k8s.office.mum.juspay.net` | `apps/backend/src/migration/slack/slackJiraffeService.ts` | **TP — fixed** | Internal cluster hostname. Now read from new `BITBOT_BASE_URL` env var; throws if unset. Added to `apps/backend/.env.example`. |
| 3 | Internal subdomain | `lightbox.sso.internal.svc.k8s.apoc.mum.juspay.net` | `apps/dashboard/src/utils/configs.ts` | **TP — fixed** | Unused `WEBSITES` list, no importers. File deleted. |
| 4 | Internal subdomain | `lightbox.sso.internal.svc.k8s.apoc.mum.juspay.net` | `apps/xyne-claw-auth/backend/prisma/migrations/20260421180000_add_juspay_internal_tools_server/migration.sql` | **TP — fixed** | Applied migration edited in place; `url` set to empty (never read, the static adapter takes its URL from env). Developers must run `prisma migrate reset` on their local claw-auth DB once. Old value remains in git history. |
| 5 | Internal subdomain | `juspay-internal-tools-ext.internal.svc.k8s.dozer.mum.juspay.net` | `apps/xyne-claw-auth/backend/src/mcp/adapters/juspay-internal-tools.ts` | **TP — fixed** | Hardcoded fallback removed; `JUSPAY_INTERNAL_TOOLS_BASE_URL` now required. Added with `JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN` to `apps/xyne-claw-auth/backend/.env.example`. |
| 6 | Internal subdomain | `research-agent.internal.svc.k8s.office.mum.juspay.net` | `packages/xyne-claw-shared/src/tools/research-agent/tools.ts` (4 fallbacks + schema default/placeholder) | **TP — fixed** | Replaced with one `RESEARCH_AGENT_API_URL_DEFAULT` from the `RESEARCH_AGENT_API_URL` env var; neutral placeholder. |
| 7 | Password | `dev-admin-password` | `docker-compose.dev.yml`, `docker-compose.test.yml`, `project.nix`, `scripts/sandbox.sh` | FP | Zero-cache admin password for the local Docker stack. |
| 8 | Password | `minioadmin` | `docker-compose.dev.yml`, `docker-compose.test.yml`, `apps/dashboard-edge/local/docker-compose.yml`, commented in `.env.example` / `.env.test` | FP | MinIO / RustFS vendor default for localhost object store. |
| 9 | Password | `xyne123` | `docker-compose.dev.yml`, `apps/backend/.env.example`, `.env.test`, `apps/xyne-claw-auth/TESTING.md` | FP | Local Postgres container password (`localhost:5433`). |
| 10 | Password | `xynelocal@123` | `README.md`, `docs/setup/*.md`, `apps/backend/scripts/seed-acl.ts`, `scripts/start-services.sh` | FP | Documented login for the seeded local admin `admin@xyne.ai`. Only exists in a locally seeded DB. |
| 11 | Password | `claw123` | `docker/init-db.sh`, `scripts/start-services.sh`, `apps/xyne-claw-auth/backend/.env.example`, `TESTING.md` | FP | Local `claw_auth_db` Postgres password; overridable via `CLAW_DB_PASSWORD`. |
| 12 | Password | `Xyne@Dev123!` | Git history only (removed in `a26b53de7`) | FP | Previous seeded local admin password, same scope as #10. Not in current tree. |
| 13 | Password | `admin` | `docker-compose.{dev,sandbox,test}.yml` (`GF_SECURITY_ADMIN_PASSWORD`) | FP | Grafana vendor default for the local observability container. |
| 14 | Password | `fpNewPassword` | `apps/dashboard/src/routes/AuthScreen/AuthScreen.tsx` | FP | React state variable name (forgot-password form). Not a value. |
| 15 | Password | `tempPassword` | `apps/backend/src/controllers/invitationController.ts`, email templates | FP | Variable holding a runtime-generated invite password. Not a value. |
| 16 | Password | `envVars.BITBUCKET_PASSWORD`, `envVars.REDIS_PASSWORD` | `apps/backend/src/config/env.ts` | FP | Code that reads a password from the environment. No value in repo. |
| 17 | Password | `${NC}` | `scripts/start-services.sh` | FP | Shell colour-reset variable in an `echo` line. |
| 18 | Password | `password-toggle-field : 0.1.11`, `password-field : 0.1.16` | lockfiles / `package.json` | FP | npm package names and versions. |
| 19 | Token | `MTIzNDU2` | `apps/backend/.env.example`, `.env.test`, `scripts/sandbox.sh` (`SUPERPOSITION_TOKEN`) | FP | Base64 of `123456`; placeholder for local Superposition. |
| 20 | workspaceid credential | `lastworkspace` | Git history only (removed in `18805afd1`) | FP | A `localStorage` key name. |
| 21 | Username | `openai` / `OpenAI` | Provider identifiers throughout | FP | Name of an LLM provider. |
| 22 | Username | `props[` | — | FP | Scanner artefact; a JavaScript fragment. |
| 23 | Username | `xyne.spaces_juspay.in` | `apps/xyne-claw-auth/backend/.env.example` (`BITBUCKET_DASHBOARD_AUTHOR_USERNAME`) | FP — **removed by policy** | A username, not a secret. Replaced with a neutral placeholder anyway. |
| 24 | Username | `usernames : [...])` | — | FP | Truncated scanner output, nothing behind it. |
| 25 | Committer emails | `xyne.spaces@`, `kushagar.goel@`, `ganesh.pendem@`, `sithaarth.m@`, `mahek.agarwal@`, `mayank.bansal@juspay.in`, one GitHub no-reply | **Not in any tracked file.** GitHub commit author metadata only. | FP | Nothing to fix in code. Removable only by a full git history rewrite, and forks keep the old commits. |
| 26 | Client email | `git@ssh.bitbucket.juspay.net` | `claw-deployments/*.yaml`, `packages/xyne-claw-shared/src/tools/sandbox/repo-configs.ts` | FP — **removed by policy** | SSH `user@host`, not an email. Host now comes from `BITBUCKET_SSH_HOST`; manifests skip the Bitbucket block when unset. |
| 27 | Client email | `api@xyne.juspay.in`, `noreply@spaces.xyne.juspay.net` | `apps/backend/src/services/apiKeyService.ts`, `packages/xyne-claw-shared/src/tools/sandbox/tools.ts` | FP — **removed by policy** | Service identities, not people. Now `API_KEY_DEFAULT_USER_EMAIL` / `API_KEY_USER_EMAIL_DOMAIN` and `SANDBOX_GIT_COMMITTER_EMAIL`, no Juspay default. |
| 28 | Client email | `ameer.noufil@juspay.com` | `tools/xyne-automation*/package.json` `author` | FP — **removed by policy** | Package author field. Email dropped. |
| 29 | Domains | `spaces.xyne.juspay.net`, `app.spaces.*`, `auth.spaces.*`, `call.xyne.*`, `api.xyne.juspay.in`, `xyne.juspay.in`, `xyne.juspay.net`, `*.xyne.juspay.net`, `external.spaces.xyne.juspay.io`, `*.sandbox.*`, `genius.juspay.in`, `dashboard.expresscheckout.juspay.in`, `airborne.juspay.in`, `sandbox.expense.juspay.in`, `juspay.in/.io/.net` | 114 files, 352 lines across backend, dashboard, electron, mobile, claw packages, Dockerfiles, docs | FP — **removed by policy** | Public DNS names, not secrets, but repo policy is no company domains in code. Done: runtime values come from env with no Juspay default; tests and docs use the generic `example.org` scheme. See "Policy sweep" below. |
| 30 | Domains | `grafana.spaces.xyne.juspay.net/xyne-mcp/*` | `.mcp.json` | FP — **removed by policy** | Authenticated dev-tooling endpoints. Replaced with `${XYNE_MCP_BASE_URL}` expansion, documented in `docs/setup/local-setup.md`. |
| 31 | Domains | `bitbucket.juspay.net`, `ssh.bitbucket.juspay.net`, `jenkins.*.juspay.net`, `mirror.bitbucket.juspay.net`, `grid.ai.juspay.net`, `api.juspay.in`, `maven.juspay.in`, `pragati.internal.staging.mum.juspay.net` | `claw-deployments/*.yaml`, claw adapters, skills, `.env.example` files, sandbox repo configs | FP — **removed by policy** | Hostnames of authenticated services, not credentials. Moved to env / `example.net` placeholders. |
| 32 | Brand match | `JUSPAY`, `Namma Yatri` | — | FP | Incidental mention; report's own triage marks repo irrelevant to that client. |
| 33 | Metadata | Languages: Python, TypeScript | GitHub | FP | Shown on any public repo's landing page. |
| 34 | Metadata | Creator / created by: `juspay/xyne-spaces`, `juspay` | GitHub | FP | Repo name and owning org. |
| 35 | Metadata | Source name: `github` | — | FP | Where the report pulled from. |
| 36 | Unlabelled | `1DUvkMcCpPm6UfMPkeZyRH3rfODQe9F56` | Not in tree or git history | FP | Likely a CloudSEK internal document ID leaked into the report template. |
| 37 | API keys / secret keys / PATs | None detected | — | Confirmed | Independent sweep for Anthropic, OpenAI, AWS, GitHub, Slack, Google key formats and PEM blocks found only test fixtures and UI placeholders. |

**Report's own contradiction:** page 2 rates HIGH; page 5 AI triage says "No sensitive exposure detected. Close the case."; page 7 verdict is "irrelevant, low confidence".

**Before deploying #2, #5, #6:** set `BITBOT_BASE_URL`, `JUSPAY_INTERNAL_TOOLS_BASE_URL`, `RESEARCH_AGENT_API_URL` in every environment using those integrations, or they fail instead of silently reaching the old hosts.

**Policy sweep (28 Oct 2026):** beyond the report's true positives, the team decided that no company domain or email address should appear anywhere in this public repo. Every `*.juspay.*` hostname and `@juspay.*` address in tracked files was replaced: runtime values come from environment variables with no Juspay default, tests and docs use `example.com`-style placeholders, applied Prisma migrations are edited in place (developers reset their local claw-auth DB once). Placeholders never mirror the real hostname layout: the deployment's own hosts are `example.org` (`app.example.org`, `auth.example.org`, `sandbox.example.org`, …); third parties stay `example.com` / `example.net`.

## Environment variables introduced by the sweep

All default to empty. Where unset, the feature fails closed with a clear error instead of reaching a Juspay host.

Backend (`apps/backend/.env.example`)
- `BITBOT_BASE_URL`
- `INTERNAL_APP_HOSTS`
- `ORG_EMAIL_DOMAIN`
- `API_KEY_USER_EMAIL_DOMAIN`
- `API_KEY_DEFAULT_USER_EMAIL`

Dashboard (`apps/dashboard/.env.example`; also Docker build args, forwarded by the `Makefile` dashboard targets)
- `VITE_API_URL`
- `VITE_INTERNAL_XYNE_HOSTS`
- `VITE_TRUSTED_ORIGINS`
- `VITE_APPS_PUBLIC_BASE_URL`
- `VITE_ELECTRON_BACKEND_URL`
- `VITE_ELECTRON_ZERO_BACKEND_URL`
- `VITE_LEGAL_CONTACT_EMAIL`
- `VITE_PRIVACY_CONTACT_EMAIL`

Dashboard-external (`apps/dashboard-external/Dockerfile` build args)
- `API_BASE_URL`
- `CALL_INVITE_BASE_URL`
- `INTERNAL_DASHBOARD_BASE_URL`

Electron (`apps/electron/src/app/config.ts`, env or electron-builder `extraMetadata`)
- `XYNE_BACKEND_URL`
- `XYNE_MTLS_BACKEND_URL`
- `XYNE_MTLS_FRONTEND_URL`
- `XYNE_UNPROTECTED_URL`
- `XYNE_FRONTEND_URL`
- `XYNE_CLAW_AUTH_URL`
- `XYNE_FIRST_PARTY_HOSTS`
- `RELEASE_CONFIG_URL`
- `UI_ZIP_URL`
- Extension: `HEALTH_CHECK_URL` and `host_permissions` in `apps/electron/extension/` (static files, set when packaging)

Site (`apps/site/lib/site.ts`)
- `NEXT_PUBLIC_SITE_URL`

Mobile (`apps/mobile/.env.example`)
- `PUBLIC_DEEP_LINK_ORIGIN`
- `LEGACY_PUBLIC_DEEP_LINK_ORIGINS`
- `ENROLLMENT_ORIGINS`
- `API_BASE_URL`
- `DASHBOARD_URL`
- `LOTUS_AIRBORNE_RELEASE_URL_ANDROID`
- `LOTUS_AIRBORNE_RELEASE_URL_IOS`
- `LOTUS_AIRBORNE_MAVEN_REPO_URL`
- `LOTUS_TELEMETRY_ENDPOINT`
- `LOTUS_GRAFANA_LOGS_ENDPOINT`

Claw-auth (`apps/xyne-claw-auth/backend/.env.example`)
- `JUSPAY_INTERNAL_TOOLS_BASE_URL`
- `JUSPAY_INTERNAL_TOOLS_VALIDATE_TOKEN`
- `JUSBIZ_MCP_URL`
- `BITBUCKET_BASE_URL`
- `LITELLM_BASE_URL`
- `PUBLIC_SPACES_URL`

Claw (`apps/xyne-claw/.env.example`)
- `SANDBOX_PREVIEW_BASE_URL`
- `SANDBOX_GIT_COMMITTER_EMAIL`
- `BITBUCKET_SSH_HOST`
- `RESEARCH_AGENT_API_URL`
- `XYNE_CLAW_BASE_URL`

Deployments (`claw-deployments/*.yaml`)
- `BITBUCKET_SSH_HOST` (plus `BITBUCKET_HOST` alias in the kata template)

Dev tooling (`.mcp.json`, documented in `docs/setup/local-setup.md`)
- `XYNE_MCP_BASE_URL`

## Left as-is, for a separate decision

| Item | Where | Why untouched |
|---|---|---|
| `xyne.ai` addresses and hosts (`admin@xyne.ai` seeded login, `*@bot.xyne.ai` bot identities, `spaces.xyne.ai` community default) | seed scripts, README, bots, community mobile variant | The product's own open-source domain, not Juspay's. Removing it changes the documented local login and bot identities. |
| `net.juspay.xynespaces*` | `apps/mobile` native code, plugins, scripts | Android/iOS bundle identifiers, not hostnames. Renaming re-identifies the apps in the stores, Firebase, App Groups and keychain. |
| `spaces.example.com` / `xyne.example.com` in `deployment/` and `helm-charts/` | self-hosting docs, tfvars, values files | Pre-existing generic examples for self-hosters, present before this sweep. |
| `@juspay/*` npm scopes, `@juspay/xyne-*-guardians` CODEOWNERS teams | package manifests, `.github/CODEOWNERS` | Package names and GitHub team handles, not domains or emails. |

## Production rollout

The public repo is the source of truth for code. Production images are built by Jenkins in `juspay/xyne-spaces-private`, which overlays its private files onto the public repo at the ref in `public-source.json` and pushes to GCR through the public `Makefile`. GitHub Actions in the public repo only publishes the open-source images to ghcr, so it stays generic and was not changed.

| Component | Where the production values now live | Status |
|---|---|---|
| Dashboard bundle (prod + sandbox, one image) | `xyne-spaces-private/Jenkinsfile`: `VITE_API_URL`, `VITE_INTERNAL_XYNE_HOSTS`, `VITE_TRUSTED_ORIGINS`, `VITE_LEGAL_CONTACT_EMAIL`, `VITE_PRIVACY_CONTACT_EMAIL` set to the previous hardcoded values in the Docker stage environment and both bundle-build blocks; forwarded as build args by `Makefile` `build-dashboard` / `push-dashboard` / `export-dashboard-bundle` | Done, uncommitted in the private repo |
| `VITE_APPS_PUBLIC_BASE_URL` | Deliberately unset. The old code picked prod vs sandbox at runtime by hostname; one image serves both, so the serving-host fallback reproduces both values | No action |
| Backend, claw-auth, claw, deployments | Helm / release overrides for `BITBOT_BASE_URL`, `ORG_EMAIL_DOMAIN`, `API_KEY_USER_EMAIL_DOMAIN`, `API_KEY_DEFAULT_USER_EMAIL`, `INTERNAL_APP_HOSTS`, `JUSPAY_INTERNAL_TOOLS_BASE_URL`, `JUSBIZ_MCP_URL`, `BITBUCKET_BASE_URL`, `LITELLM_BASE_URL`, `PUBLIC_SPACES_URL`, `BITBUCKET_SSH_HOST`, `RESEARCH_AGENT_API_URL`, `SANDBOX_PREVIEW_BASE_URL` | **Open**: set in the environment overrides repo before the next release |
| Electron desktop (prod + sandbox) | `XYNE_*` values via env or electron-builder `extraMetadata` | **Open**: packaging job not found in either repo's Jenkinsfile |
| Mobile prebuild | `apps/mobile/.env.*` (gitignored) must set `PUBLIC_DEEP_LINK_ORIGIN`, `API_BASE_URL`, `ENROLLMENT_ORIGINS`, `LOTUS_AIRBORNE_*` | **Open**: prebuild throws until set |

## Verification status

| Check | Result |
|---|---|
| Repo-wide grep for `juspay.(in\|io\|net\|com)` hostnames | 0 hits (lockfiles and this doc excluded) |
| Repo-wide grep for `@…juspay` emails | 0 hits (only npm scopes and CODEOWNERS team handles remain) |
| Placeholders mirroring the real hostname layout | 0 hits outside the pre-existing `deployment/` and `helm-charts/` self-hosting examples |
| `pnpm install --frozen-lockfile` | OK (Node 22.23.4, pnpm 10.15.0) |
| `apps/dashboard` `tsc --noEmit` | OK |
| `apps/dashboard` `vitest run` | 114 passed, 1 failed in `activityVisibility.test.ts`, a file this change never touched |
| Backend, claw-auth, claw-shared, mobile, electron typecheck and tests | **Not yet run**. The mobile agent changed the signatures of `canonicalizePublicDeepLink` and `canIncludeEmailInRemoteLogs`; run `tsc` there first |
| Local stack (`pnpm run services`, backend + dashboard dev) | Up on 28 Oct 2026: Postgres, Redis, Zero, RustFS healthy; backend `/api/health` 200 on :3001; dashboard 200 on :5173. Claw-auth seed fails at HEAD (`seed.ts` imports `xyne-workflows-tools.js`, deleted in `9e13ca3ed`), pre-existing, Claw features only |
