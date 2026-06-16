# Release Manager

The release manager helps a release captain plan and ship a release: it
discovers what changed for a release across multiple apps, surfaces
env / migration changes that need attention in prod, tracks each dev
ticket's deployment through the board's stages, and publishes a shareable
release report.

There are **two ways a release discovers its changes**, picked per
release board:

- **Commit-range mode** — you give the board a `deployedCommitId` →
  `newCommitId` range; the backend walks the commits in Bitbucket, maps
  each to its merged PR and dev ticket, and captures the diffs.
- **Version mode** — dev tickets and the release ticket carry a shared
  `releaseVersion` string; whenever a version field changes, the backend
  re-maps the matching dev tickets onto the release using their
  already-linked PR diffs (no commit walk).

Both modes converge on the same primitives: per-app sub-tickets, ART
rows (one per app × dev-ticket), `release_change_types` change events +
their env/migration form bags, and the dashboard release detail screen.

> **Both modes are implemented today.** Earlier drafts of this doc said
> version mode was groundwork-only — that is no longer true. See
> [Version mode](#version-mode) for what it does and how it differs.

## Setup

### Quickstart (local)

Run these once, from the repo root:

```bash
# 1. Sync the DB schema. Local dev uses `prisma db push` (NOT migration files) —
#    `npm run services` already runs db push on every start, so normally you do
#    nothing here. After pulling new schema changes, just re-run `npm run services`
#    (or, to push manually):  cd backend && npx dotenv -e .env.local -- npx prisma db push

# 2. Seed system data — ticket types + the release forms.  REQUIRED.
#    Skip this and you get NO "Release" ticket type and NO release form,
#    and the config wizard will throw when it tries to bind the board.
npx tsx backend/scripts/release-manager-localdev/seed-release.ts

# 3. Sanity check (read-only): forms exist + RELEASE boards are bound
npx tsx backend/scripts/release-manager-localdev/verify-release-setup.ts

# 4. Local Xyne only — swap the generic 4-stage set for the 9-stage lifecycle.
#    Do NOT run in prod.
npx tsx backend/scripts/release-manager-localdev/seed-release-stages.ts
```

> The scripts moved from `backend/scripts/release-manager/` to
> **`backend/scripts/release-manager-localdev/`**. Some in-file comments and a
> couple of mutator error messages still reference the old `release-manager/`
> path — that's a stale-string discrepancy, the on-disk directory is
> `release-manager-localdev/`.

> **Do other devs need to run migrations locally? No.** Local schema is applied
> by `prisma db push` (run automatically by `npm run services` on every start),
> which syncs `schema.prisma` directly — the `prisma/migrations/*` SQL files are
> only applied in sandbox/prod. So a teammate just needs: `git pull` →
> `npm run services` → `seed-release.ts` (once).

Add to `backend/.env.local`:

```bash
BITBUCKET_BASE_URL=https://bitbucket.example.com
BITBUCKET_AUTH=<http-access-token>        # or set BITBUCKET_USERNAME + BITBUCKET_PASSWORD
RELEASE_AUTOSTUB_MISSING_TICKETS=1        # local only: stub dev tickets whose XYNE-ids aren't in your DB
```

Then in the dashboard:

1. Open your project → **Release** tab → run the **Release Config**
   wizard: pick the VCS provider (only Bitbucket Server is enabled),
   pick a **tracking mode** (commit-range or version), pick a release
   channel, and add apps (name, regex, repo URL, env/migration paths,
   owner team). This creates the main RELEASE board + one RELEASE board
   per app.
2. Set the project's **`code`** to your PR ticket prefix (e.g. `XYNE`, so PR
   titles like `XYNE-1234 …` are matched). Commit-range mode needs this to
   extract dev-ticket ids from PR titles.
3. Create a ticket on the main RELEASE board → pick type **Release** →
   fill the spec form. Commit-range boards ask for
   `branch` / `deployedCommitId` / `newCommitId`; version boards ask for
   `releaseVersion`. The release runs.

> The seeder (step 2) and the wizard (UI step 1) are **order-independent** — run
> them in either order, just run both once. If the ticket-type dropdown or
> release form don't appear after configuring, you skipped the seeder: run it and
> hard-refresh. (The wizard's save mutator actually *throws* if the spec form
> isn't seeded, so a fresh project must be seeded first.)

### Troubleshooting

| Symptom | Fix |
|---|---|
| No **Release** option in the ticket-type dropdown, or no form on the board | Seeder not run → `npx tsx backend/scripts/release-manager-localdev/seed-release.ts`, then hard-refresh |
| Wizard "Save" throws about a missing form | Spec form not seeded for the workspace → run the seeder, then re-save |
| Commit-range release finds no commits / PRs / dev tickets | Bitbucket creds missing or wrong `Project.code` → set creds in `.env.local`; set project `code` to your ticket prefix |
| Release runs but the **Envs / Migrations** tabs are empty | The app's `envPaths` / `migrationPaths` are `[]` → backfill them (see [below](#applicationenvpaths--migrationpaths-backfill)) |
| **Dev Tickets** tab empty in local | PR ticket-ids aren't in your local DB → set `RELEASE_AUTOSTUB_MISSING_TICKETS=1` |
| Edit-config wizard won't open / rejects an existing board | The main board has NULL `vcsProvider` / `releaseTrackingMode` (legacy data) → run `backfill-legacy-release-ownership.sql` |
| Every Dev Owner shows **System Administrator** | Old autostubs predate author-backed assignment → clear them: `npx tsx backend/scripts/release-manager-localdev/cleanup-autostub-tickets.ts --delete`, then re-run the release |

### Helper scripts (`backend/scripts/release-manager-localdev/`)

| Script | What it does |
|---|---|
| `seed-release.ts` | **Required setup.** Seeds TICKET_TYPE lookups + the release forms per workspace (specs, version-specs, env, migration), and binds every existing RELEASE board to the spec form matching its effective tracking mode. Idempotent. |
| `verify-release-setup.ts` | Read-only diagnostic: prints whether lookups/forms exist and which RELEASE boards are bound to the correct spec form. |
| `seed-release-stages.ts` | **Local Xyne only.** Swaps the generic 4-stage set for the richer 9-stage lifecycle on every RELEASE board (Created → Env_Ready → Initiated → Tested → Approved → In_Progress → Monitoring → Completed / Reverted). Don't run in prod. |
| `cleanup-autostub-tickets.ts` | Lists (or with `--delete`, removes) the dev autostub tickets + their hard-FK dependents (ART, activities, mappings, …), so a re-run regenerates fresh ones. |
| `backfill-legacy-release-ownership.sql` | **One-time prod data fix.** Sets `applications.mainReleaseBoardId` (from the project's single unclaimed RELEASE board) and `boards.vcsProvider` / `releaseTrackingMode` for legacy main boards so the edit-config wizard accepts them. Idempotent (only touches NULLs). Run with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f …`. |

### How config gets saved (wizard vs REST)

There are two write paths. The **wizard is the real one**; the REST
endpoint is an older programmatic backfill.

| | Wizard | REST backfill |
|---|---|---|
| Entry | `ReleaseConfigWizard` → `useReleaseConfigForm.handleSave` | `POST /api/admin/applications/backfill` (admin) |
| Persistence | Zero mutator **`project.saveReleaseBoardConfig`** (`backend/src/zero/mutators.ts`) | `applicationBackfillService.backfillApplications` |
| Board naming | `{repo}_{project}_release` (main), `{app}_{project}_application_release` (per app) | `{app}_release` (per app) |
| Default stages | generic 4-stage (`BACKLOG`/`IN PROGRESS`/`COMPLETED`/`NOT REQUIRED`) | 3-stage (`TODO`/`IN-PROGRESS`/`COMPLETED`) |
| Form binding | binds the **main board only** to the mode's spec form; throws if the form isn't seeded | seeds env/migration/specs forms + TICKET_TYPE lookups itself |

The wizard mutator (`saveReleaseBoardConfig`) writes, in one Zero push
transaction:

1. The **main release board** (`boardType=RELEASE`) carrying
   `vcsProvider` + `releaseTrackingMode`.
2. Default stages on each newly created board (the minimal prod set — it
   deliberately does **not** seed the richer Xyne-Spaces lifecycle).
3. A `forms_context_mapping` binding the **main board** to
   `xyne_release_specs_form` (commit-range) or
   `xyne_release_version_specs_form` (version). Application boards get no
   form mapping — release tickets are only created on the main board.
4. One **application board** per app (`boardType=RELEASE`, no
   vcsProvider/mode) + its default stages.
5. One **`applications`** row per app (regex, repoUrl, ownerTeam,
   `envPaths[]`, `migrationPaths[]`, channelId, mainReleaseBoardId).

All apps under one main board **share a single repo URL**. Apps removed
from the payload are deleted — but only if their board has no tickets,
else the mutator throws.

### Why seed + wizard are both needed

| Created by the **wizard** (`saveReleaseBoardConfig`) | Created by **`seed-release.ts`** |
|---|---|
| Project + main board + per-app RELEASE boards | TICKET_TYPE lookup values (→ ticket-type dropdown) |
| Default board stages | `xyne_release_specs_form` + `xyne_release_version_specs_form` (→ the spec forms) |
| `applications` rows (regex, env/migration paths) | `xyne_release_env_form` / `xyne_release_migration_form` (→ change storage) |
| `forms_context_mapping` for the main board (**requires the form to exist**) | `forms_context_mapping` for every pre-existing RELEASE board |

The wizard binds the board to the spec form *only if the form has been
seeded* — and now throws outright if it hasn't. So the seeder must run
once per workspace before (or regardless of) configuring projects.

### Sandbox / prod deployment

1. **Run `seed-release.ts` once** during deploy (fresh install or backfill).
   Idempotent — safe to re-run.
2. **Set Bitbucket creds** (`BITBUCKET_BASE_URL` + `BITBUCKET_AUTH`, or
   username/password) in the deployment environment.
3. **Set each project's `code`** to its real ticket prefix.
4. **Run `backfill-legacy-release-ownership.sql`** for pre-v2 workspaces so
   legacy main boards get `vcsProvider` / `releaseTrackingMode` and apps get
   `mainReleaseBoardId`.
5. **Do NOT run `seed-release-stages.ts`** (Xyne-Spaces local lifecycle, not a
   prod default) and **leave `RELEASE_AUTOSTUB_MISSING_TICKETS` unset** (it's
   double-guarded to no-op in prod anyway).
6. **Backfill `envPaths` / `migrationPaths`** for pre-existing apps (see below),
   and run the data checks under [Prod data fixes](#prod-data-fixes--known-todos).

### Prod readiness checks (SQL)

Older prod workspaces already have the TICKET_TYPE lookups and the
`xyne_release_specs_form` from earlier seeding. The checks below confirm
the **v2-specific** pieces are present. Anything that comes back
empty/zero (or with `0` paths) needs the corresponding fix above.

```sql
-- 1. v2 migration applied? (expect every listed column to come back)
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='applications'              AND column_name IN ('envPaths','migrationPaths','deployedVersion','mainReleaseBoardId'))
   OR (table_name='boards'                    AND column_name IN ('vcsProvider','releaseTrackingMode'))
   OR (table_name='application_release_tickets' AND column_name IN ('releaseId'))
   OR (table_name='release_change_types'      AND column_name IN ('applicationReleaseId','commitId','devTicketXyneId','filePath','releaseId'))
ORDER BY table_name, column_name;

-- 2. Env + migration change forms exist. Expect 1 per workspace.
SELECT "formName", COUNT(*) FROM forms
WHERE "formName" IN ('xyne_release_env_form','xyne_release_migration_form')
GROUP BY "formName";

-- 3. Every RELEASE board's tracking config is set (legacy boards may be NULL).
SELECT id, name, "boardType", "vcsProvider", "releaseTrackingMode"
FROM boards WHERE "boardType"='RELEASE' ORDER BY name;

-- 4. Apps have env/migration paths set (THE common gap — empty = silently
--    captures zero changes). Any row with 0 needs a backfill.
SELECT id, name,
       coalesce(array_length("envPaths",1),0)       AS env_paths,
       coalesce(array_length("migrationPaths",1),0)  AS mig_paths,
       "mainReleaseBoardId"
FROM applications ORDER BY name;

-- 5. Projects that use release manager have a code set.
SELECT id, name, code FROM projects;

-- 6. Legacy release-form rows missing contextId (see Prod data fixes).
SELECT COUNT(*) FROM form_entity_values
WHERE "entityType" IN ('RELEASE_ENV_FORM','RELEASE_MIGRATION_FORM') AND "contextId" IS NULL;
```

## Domain vocabulary

| Term | Meaning |
|---|---|
| **Release ticket** | A `Ticket` of `ticketType=Release` (or `Hotfix`), created on the **main** RELEASE board. Carries the deploy specs (branch + commit ids, or `releaseVersion`). The user-facing entry point. |
| **App sub-ticket** | A `SubTicket` auto-created per affected `Application`, on that app's RELEASE board. `ART.applicationReleaseId` points at it. |
| **Application** | A deployable unit in a project — own repo, regex, `envPaths`, `migrationPaths`, its own RELEASE board (`boardId`) and an owning `mainReleaseBoardId`. Configured via the wizard. |
| **Dev ticket** | A regular ticket whose PR shipped in this release. In commit-range mode it's found by parsing the PR title; in version mode it's any ticket sharing the release's `releaseVersion`. |
| **ART (`application_release_tickets`)** | One row per (release × app sub-ticket × dev-ticket). Holds release-scoped QA metadata: `testedBy`, `testedAt`, `failureReason`, plus `releaseId`. The dev ticket is referenced by `ticketId` (its UUID); its label/type/assignee are read through the `devTicket` Zero relation. **ART has no `status`/`title` columns** — both were dropped in v2; test/stage status is single-sourced on the dev ticket (`statusV2`/`stageName`). |
| **`release_change_types`** | One row per `(release × app × dev-ticket × commit × file × kind)` change event. EAV anchor for the env / migration form bag. |
| **Main release board** | The `boardType=RELEASE` board that carries `vcsProvider` + `releaseTrackingMode` and owns the per-app boards (via `Application.mainReleaseBoardId`). Release tickets live here. |
| **Tracking mode** | `COMMIT_RANGE` or `VERSION` — a `Board.releaseTrackingMode` enum that selects which discovery pipeline runs. |

> **Schema correction (read this if you've seen older docs):**
> `vcsProvider` and `releaseTrackingMode` live on **`Board`** (the main
> release board), **not** on `Project`. There is **no `repositoryType`
> field** anywhere — `vcsProvider` is the VCS discriminator.
> `Project.code` is just the ticket-id prefix.

## Module map

| File | Responsibility |
|---|---|
| `backend/src/controllers/commitAnalysisController.ts` | Commit-range entry point. Derives release context (gate-checks mode + VCS, resolves repo from the shared `Application.repoUrl`), runs analysis, posts the loading→summary message + canvas. |
| `backend/src/services/commitAnalysisService.ts` | Heaviest file. Walks commits, maps commit→PR→dev-ticket, categorizes env/migration files, writes `release_change_types` rows + form bags. Used by both modes (commit-diff and PR-diff variants). |
| `backend/src/services/release/core/releaseService.ts` | Commit-range orchestrator: analyze → detect apps → provision sub-tickets → ART rows → per-app change capture. |
| `backend/src/services/release/core/ChangeDetector.ts` | Categorizes file paths into `env` / `migration` / `other` using each `Application`'s `envPaths` / `migrationPaths`. **Substring/suffix match** (`includes`/`endsWith`), env wins on overlap. |
| `backend/src/services/release/core/diffParser.ts` | Static parsing of raw git diffs. `parseEnvDiff` → cleaned `oldValue`/`newValue`. `parseMigrationDiff` → `query` (+ Prisma model blocks) + cleaned `changeLog`. Only collects `+`/`-` lines inside `@@` hunks. |
| `backend/src/services/release/core/mapper.ts` | Pure mappers: PR-links-by-app, ART row mappings (one per app sub-ticket × dev-ticket where the PR touched the app's files), per-app result filtering. |
| `backend/src/services/release/versionReleaseMappingService.ts` | **Version mode.** Keeps ART rows + change rows in sync as `releaseVersion` fields change — maps dev↔release tickets by shared version, captures PR diffs, and *removes* stale rows. Fully implemented. |
| `backend/src/services/bitbucketService.ts` | Bitbucket Server REST client (retry/backoff, pagination): `getCommitsBetween`, `getMergedPullRequest`, `getCommitChanges`, `getFileDiff`, `getPRDiff`. |
| `backend/src/utils/repoUrlParser.ts` | `parseBitbucketRepoUrl` → `{projectKey, repoSlug}` from a Bitbucket URL. |
| `backend/src/services/release/xyne/xyneReleaseForm.ts` | Form schema definitions (fields per env/migration form). |
| `backend/src/services/release/applicationBackfillService.ts` | REST-path workspace setup / form + lookup seeding. Idempotent. |
| `backend/src/database/repositories/releaseRepository.ts` | DB access for `release_change_types` + the form bag (atomic value-write + `FORM_SAVED` event). |
| `backend/src/database/repositories/applicationRepository.ts` | Runtime release execution: `createApplicationSubTickets`, `createApplicationReleaseTicketMappings` (ART), `updateDeployedCommit`. |
| `backend/src/services/releaseReports/releaseReportService.ts` | Gathers the `ReleaseReport` and publishes it (canvas + thread message + ticket metadata), under a Postgres advisory lock. |
| `backend/src/services/releaseReports/releaseReportCanvas.ts` | Renders the report into BlockNote blocks (dev-ticket table + env/migration sections) and creates/updates the canvas. |
| `backend/src/controllers/releaseReportController.ts` | `POST /tickets/:ticketId/release-report/publish` — auth + channel-visibility gate. |
| `backend/src/utils/commitAnalysisCanvas.ts` | The (older) commit-analysis canvas posted at release-creation time — distinct from the release report. |
| `shared/src/release/releaseReport.ts` | The `ReleaseReport` shape + `PublishReleaseReportResponse` contract. |
| `shared/src/utils/csv.ts` | `escapeCsvCell` / `serializeCsv` — CSV-injection-safe serializer shared by backend & dashboard. |
| `dashboard/src/components/Release/ReleaseConfigWizard/` | The config wizard (steps, form state, board-name helpers). |
| `dashboard/src/routes/ReleaseDetailScreen/ReleaseDetailScreen.tsx` | Release detail page: Dev Tickets / Envs / Migrations tabs, pickers, CSV export, report publish. |
| `dashboard/src/routes/ProjectDetailScreen/ReleasesSection.tsx` | Lists release tickets for a project (the entry into a release). |
| `dashboard/src/components/Release/ChangeCards.tsx` | Shared collapsible-card UI for env / migration change rendering (`cleanDiff` at render time). |
| `dashboard/src/components/Release/envVars.ts` | Parses env variable names from cleaned `newValue`/`oldValue` for badge counts. |
| `dashboard/src/components/Release/{ReleaseStagePicker,DevTicketStagePicker,QAOwnerPicker}.tsx` | Stage / QA-owner inline pickers (mutate the release ticket, the ART row, or the dev ticket). |

## End-to-end flow

### Commit-range mode

When a user creates a release ticket on a commit-range main board:

1. **Ticket creation** — the create-ticket modal renders
   `xyne_release_specs_form`. On a release board the modal forces
   `ticketType=Release` and auto-prefills `deployedCommitId` from
   `GET /commits/analyze/latest-deployed-commit?mainReleaseBoardId=…`.
   The user fills `branch` / `deployedCommitId` / `newCommitId`.
2. **Trigger** — `ticketController` fires
   `commitAnalysisController.analyzeCommits(...)` (fire-and-forget, as the
   release bot) when the new ticket is a release ticket on a non-version
   board with the commit fields set.
3. **Derive context** — `deriveReleaseContext` gate-checks
   `releaseTrackingMode=COMMIT_RANGE` and `vcsProvider=BITBUCKET_SERVER`
   (only Bitbucket Server is supported in v1), confirms the board has ≥1
   app sharing one `repoUrl`, parses `{projectKey, repoSlug}`, and reads
   the ticket-id prefix from `Project.code`.
4. **Commit walk** — `getCommitsBetween` for the range (`since` is
   exclusive in Bitbucket, so the start commit is re-added). Per commit:
   `getMergedPullRequest` → `extractTicketId(prTitle, prefix)` (regex
   `^PREFIX-\d+` preferred, `\bPREFIX-\d+` fallback) →
   `getTicketByXyneId` → `getCommitChanges`.
5. **App detection** — `detectAffectedApplications` matches each changed
   path against every `Application.regex` (full `RegExp.test`).
6. **Sub-tickets** — `createApplicationSubTickets` creates a Ticket +
   SubTicket + mapping per affected app on that app's board (lowest-sequence
   stage), with PR links in the description.
7. **ART rows** — `buildApplicationReleaseTicketMappings` →
   `createApplicationReleaseTicketMappings` writes one row per (app
   sub-ticket × dev-ticket) where the PR touched the app's files
   (`createMany skipDuplicates`, unique `(applicationReleaseId, ticketId)`).
   Failure emits a `MAPPING_WRITE_FAILED` event and aborts.
8. **Change capture** — per app, a `ChangeDetector` built from the app's
   `envPaths`/`migrationPaths` categorizes the commit's files. For each
   env/migration file: dedupe, `getFileDiff`, `DiffParser.parse*`,
   `createReleaseChangeInstance` (a `release_change_types` row), then the
   env/migration form bag is written atomically with a `FORM_SAVED` event.
9. **Deployed commit** — `updateDeployedCommits` sets
   `Application.deployedCommit = newCommitId`.
10. **Canvas + summary** — `createCommitAnalysisCanvas` builds the
    commit-analysis canvas, posted to the release channel; the loading
    message is rewritten into a "Release Analysis Complete" summary.

### Version mode

Version mode never walks a commit range. It is driven by
**`versionReleaseMappingService.syncTicketById(ticketId)`**, fired from
`ticketController` whenever a ticket's `releaseVersion` form field is
written. Runs are serialized per-ticket so rapid edits don't interleave
(latest version wins).

1. **Resolve version** — read the ticket's current `releaseVersion`
   (form value whose field is named `releaseVersion`).
2. **Branch** — a *release* ticket on a `VERSION` board syncs all dev
   tickets sharing that version; a *dev* ticket syncs all release tickets
   sharing it. Matching tickets are found by querying `form_entity_values`
   for the `releaseVersion` field id with the value (JSON equality, in-DB).
3. **Map each dev ↔ release** (`mapDevTicketToRelease`) — load the dev
   ticket's linked `PullRequests` rows (skip if none). For each PR,
   `getPRDiff(projectKey, repoSlug, prId)` (repo parsed from
   `pr.repositoryUrl`), run the same regex `detectAffectedApplications`
   over the diff paths. Ensure/reuse per-app sub-tickets, write ART rows,
   and capture changes via
   `saveReleaseChangesFromPullRequestDiffs` (the PR-diff sibling of the
   commit-diff path — same `DiffParser` + form-bag write).
4. **Cleanup stale rows** — on every sync, version mode *removes* ART +
   `release_change_types` + form-value rows for dev tickets no longer
   sharing the version (the commit-range path only ever adds). Done in a
   `$transaction`, form values first (no FK), then change rows, then ART
   rows last; app sub-tickets are kept (other dev tickets may use them).
5. **Deployed version** — when a version release ticket reaches
   `COMPLETED`, `updateDeployedVersionOnCompletion` sets
   `Application.deployedVersion` + `lastDeployedAt` for the board's apps.

**Key differences from commit-range:** the dev↔release link is the
shared version string (no PR-title parsing); the dev ticket is known up
front; PR diffs come from already-linked `PullRequests` rows; and stale
mappings are actively pruned.

## Schema overview

```
tickets
  ├── ticketType = 'Release' | 'Hotfix'   ← the release ticket (on the main RELEASE board)
  └── ticketType = 'Fix'/etc.             ← dev tickets shipped in this release
              ▲
              │  release scope is a plain string column (no FK), matched on:
              │     ART.releaseId, release_change_types.releaseId, release_events.releaseId
sub_tickets                               ← per-app slice of a release (on the app's RELEASE board)
  └── id  ────►  application_release_tickets (ART)         [testing cell]
                  ├── applicationReleaseId → sub_tickets.id   (Zero rel: subTicket)
                  ├── ticketId             → tickets.id       (Zero rel: devTicket)
                  ├── releaseId            = release ticket id
                  └── testedBy, testedAt, failureReason   (NO status/title columns)
                  ▲   unique(applicationReleaseId, ticketId)
                  │
release_change_types                      ← one row per change event
  ├── releaseId                           (link to release ticket)
  ├── applicationReleaseId                (link to app sub-ticket)
  ├── applicationId  ──► applications.id  (Zero rel: application)
  ├── devTicketXyneId                     (which dev ticket introduced this; no FK)
  ├── commitId                            (which commit touched the file)
  ├── filePath                            (the file; also the dedupe key)
  ├── changeType                          ('env' | 'migrations' | …)
  └── id  ────►  form_entity_values
                   (entityId  = release_change_types.id,
                    entityType = RELEASE_ENV_FORM | RELEASE_MIGRATION_FORM,
                    contextId  = releaseId,            ← release scoping, indexed
                    fieldId → fileName / filePath / fileSlug / changeType /
                              oldValue / newValue / description    [ENV]
                              filePath / changeLog / query / description  [MIGRATION])

applications
  ├── boardId            → its own RELEASE board (unique)
  ├── mainReleaseBoardId → the owning main RELEASE board (carries vcsProvider + mode)
  ├── regex              (matched against changed paths to detect the app)
  ├── envPaths[] / migrationPaths[]   (substring/suffix patterns for ChangeDetector)
  └── deployedCommit / deployedVersion / lastDeployedAt   (per tracking mode)

boards (boardType = RELEASE)
  ├── vcsProvider          VCSProviderType?  (GITHUB | BITBUCKET_CLOUD | BITBUCKET_SERVER)
  └── releaseTrackingMode  ReleaseTrackingMode?  (COMMIT_RANGE | VERSION)
```

> **New in v2** (`20260612182524_release_management_updated_schema`):
> `boards.vcsProvider` + `releaseTrackingMode`; `applications.envPaths`,
> `migrationPaths`, `deployedVersion`, `mainReleaseBoardId`, `lastDeployedAt`,
> `updatedAt`; `application_release_tickets.releaseId` + `updatedAt`, and the
> **drop** of its `status` + `title` columns; `release_change_types`
> `applicationReleaseId`, `commitId`, `devTicketXyneId`, `filePath`,
> `releaseId`, `createdAt`. Enums `VCSProviderType` + `ReleaseTrackingMode`
> added; `ApplicationReleaseTicketStatus` dropped.

> **Zero relations:** the `devTicket` / `subTicket` relations on ART, and
> the release-table relationships, are defined in the **authoritative**
> `shared/src/zero/schema.ts`. The generated
> `backend/prisma/generated/zero/schema.ts` is missing them — use the
> shared file as the reference.

### Form fields per kind

**`xyne_release_env_form`** (one bag per change event):
- `fileName` — last path component
- `filePath` — full path
- `fileSlug` — file-derived slug (e.g. `.env.local` → `_ENV_LOCAL`).
  **Renamed from the old misleading `envKey`** — it is *not* a variable
  name. Actual var names are derived at read time (see below).
- `changeType` — `ADDED` / `MODIFIED` / `REMOVED`
- `oldValue` — concatenated `-` lines (marker stripped at write time)
- `newValue` — concatenated `+` lines (marker stripped at write time)
- `description` — change summary (e.g. "Added 3 line(s) to env.ts")

**`xyne_release_migration_form`** (one bag per change event):
- `filePath` — full path
- `changeLog` — cleaned diff content (git metadata + line markers
  stripped at write time)
- `query` — extracted SQL (or Prisma `model { … }` blocks)
- `description` — `"Database migration file ${fileName} changed."`

### Variable counts (dashboard)

Env-var counts on the Envs tab badge, the per-dev-ticket Changes badge,
and the dev-ticket row are computed **at read time** by
`extractEnvVarsFromBag` in `dashboard/src/components/Release/envVars.ts`.
The helper regex-parses the cleaned `newValue` / `oldValue` for
`[A-Za-z][A-Za-z0-9_]*` identifiers followed by `=` or `:`, then unions
across rows in the scope. Migration counts are unique file paths.

The same name set is computed on the backend for the release report
(`extractEnvironmentVariableNames` in `releaseReportService.ts`) and,
with a more granular ADD/DELETE/MODIFY classification, in
`commitAnalysisCanvas.parseEnvChanges`. The duplication across these
three is documented as future-scope work — see below.

## Release reports

A release report is a structured snapshot of a release ticket — its dev
tickets, env-variable changes, and migrations — published as a BlockNote
**canvas** plus a system message in the release thread. There is also a
purely client-side **CSV export** of the dev-ticket table.

### Publishing (server)

- **Endpoint:** `POST /tickets/:ticketId/release-report/publish`
  (`authorize('TICKETS', WRITE)`).
- **Gate** (`releaseReportController.publish`): ticket must exist, belong
  to the caller's workspace, be a Release/Hotfix ticket, and have a
  conversation/channel; private channels require the caller to be a
  participant.
- **Gather** (`releaseReportService.gatherReleaseReport`): pure assembly,
  no writes — reads the ART rows, `release_change_types` + their form
  values, dev tickets, applications, PR urls, and the `releaseVersion`,
  then builds the `ReleaseReport` (`summary` counts, `devTickets[]`,
  `environmentChanges[]`, `migrations[]`).
- **Publish** (`publishLocked`, under a Postgres advisory xact lock keyed
  on the ticket so concurrent publishes serialize):
  1. Bump `releaseReportVersion` (from ticket metadata).
  2. `ReleaseReportCanvasService.createOrUpdate` — find the existing
     report canvas (by `metadata.source='release_report'` +
     `releaseTicketId`) and update it, else create one. Canvas is PUBLIC,
     read-only, owned by the `xyne-release-bot` (falls back to the
     publisher), and queued for Vespa indexing.
  3. Post or update the **release-thread system message**
     ("Release Report Published/Updated … [View Release Report]"),
     idempotent via `findExistingReleaseReportMessage`.
  4. Persist canvas id/url/version + `releaseReportPublicationStatus`
     (`PUBLISHED` / `PARTIAL_FAILURE`) onto the ticket metadata.
- **Partial-failure model:** the canvas is the source of truth. The
  thread message and metadata writes are best-effort — if either fails
  the response is `partialFailure: true` (canvas still published), never
  a rollback.

The report shape lives in `shared/src/release/releaseReport.ts`. Note
`ReleaseReportChange.repositoryUrl` and `.createdAt` are populated but
not currently rendered. There is **no GET endpoint** — the only ways to
read a report are the published canvas or the CSV.

### CSV export (client)

The Dev Tickets tab's "Export as CSV" button runs entirely in the
browser — no backend call. `buildReleaseDetailDevTicketRows` mirrors the
backend's dev-ticket builder over Zero-synced data,
`buildDevTicketsCsv` serializes via the shared `serializeCsv` (same 8
columns as the canvas table), and `downloadCsvFile` triggers a
BOM-prefixed blob download (`<xyneId>-v<n>-dev-tickets-<date>.csv`). CSV
cells are injection-hardened by `escapeCsvCell` (`shared/src/utils/csv.ts`).

## Dashboard UI

Releases are listed on the project's **Release** tab
(`ReleasesSection`); clicking a row opens
`/listProjects/:projectId/releases/:releaseTicketId` →
`ReleaseDetailScreen`. (There is no separate per-ART detail screen — all
ART data renders inline on the Dev Tickets tab.)

`ReleaseDetailScreen` has a header (release label, status picker, version
chip) and three tabs:

- **Dev Tickets** (`testing`) — toolbar with **Export as CSV** and
  **Publish/Update Report**; a table of dev-ticket rows (Ticket Id, Title,
  PR, Dev Owner, Type, **Status**, **Changes** badge, **QA Owner**).
- **Envs** — `ChangeSections` of env changes grouped by app; badge =
  release-wide unique env-var count.
- **Migrations** — `ChangeSections` of migration changes; badge = total
  migration files. The heavy `changeLog` bodies only sync when this tab
  is active (the query is gated on `activeTab === 'migrations'`).

### Pickers — what each one mutates

| Picker | Where | Mutates | Entity |
|---|---|---|---|
| `ReleaseStagePicker` (default path) | Release header + `ReleasesSection` rows | `ticket.update({ stageName, statusV2 })` | the **release ticket** (`tickets`) |
| `DevTicketStagePicker` | Dev Tickets "Status" column | `applicationReleaseTicket.updateStatus` | the **ART** row (mirrors `statusV2`/`stageName` onto the dev ticket when the caller has channel access; server handles it otherwise) |
| `QAOwnerPicker` | Dev Tickets "QA Owner" column | `applicationReleaseTicket.setTestedBy` | the **ART** row (`testedBy` only) |

Picking a `CANCELLED` stage in `DevTicketStagePicker` does **not** mutate
immediately — it opens the **failure-reason dialog**
(`useFailureReasonDialog`); the stage change is committed (with the
`failureReason`) only after a reason is entered. `updateStatus` also sets
`testedAt` on all ART rows sharing the dev ticket when the status is
`COMPLETED`/`CANCELLED`.

So: dev-ticket stage/status is single-sourced on the dev `tickets` row;
ART carries only `testedBy` / `testedAt` / `failureReason`.

### Change rendering

`buildGroupedByApp` turns `release_change_types` rows into
app → file → change groups; `filterGroupsByKind` splits ENV vs MIGRATION;
`ChangeSections` / `ChangeCard` / `ChangeBlock` render them. ENV changes
show stacked red (`oldValue`) / green (`newValue`) blocks; MIGRATION
changes run `cleanDiff(changeLog)` (strips git-diff metadata/markers at
render time, idempotent on already-clean strings) and render plain mono
text (no per-line coloring, so SQL `--` comments aren't misread as
deletions). File-path and commit links point at Bitbucket browse URLs.

## Future scope

### Per-ticket merge-time env/migration calc

Move analysis from release-creation to the dev ticket's PR-merge event.
Each dev ticket would own its env/migration changes (via new
`TICKET_ENV_CHANGES` / `TICKET_MIGRATION_CHANGES` form entityTypes,
attached to the dev ticket's `entityId` with `contextId = boardId`). The
release view becomes a cheap aggregation across the release's dev
tickets.

Benefits:
- Cheaper release creation — no per-commit Bitbucket round-trips.
- Cleaner ontology — env changes are a property of the merge, not the
  deploy event.
- Per-ticket standalone view (e.g. for QA, preview environments).
- Re-running a release becomes a no-op (data already pinned to tickets).

**Open issue blocking this work:** hotfix workflows make the "merged"
signal unreliable. Cherry-picks, partial merges, force-pushes to release
branches, and rollback-and-revert sequences don't cleanly transition the
dev ticket through a `Merged` stage. Solving this needs work on the
trigger reliability (probably a Bitbucket webhook on
`pullrequest:fulfilled` rather than a stage-change hook) and
deduplication logic for tickets that appear in multiple deploys.

Version mode is a partial step in this direction — the dev↔release link
no longer needs a commit walk — but it still re-derives changes from PR
diffs at sync time rather than pinning them at merge.

### Collapse the duplicated env-var parsers

Env-var name parsing now exists in **three** places with subtly
different regexes:
- `commitAnalysisCanvas.parseEnvChanges` — raw diffs (with `+`/`-`),
  classifies ADD/DELETE/MODIFY.
- `releaseReportService.extractEnvironmentVariableNames` — cleaned
  values, names only.
- `dashboard/src/components/Release/envVars.ts` — cleaned values, names
  only (the canonical dashboard count).

Moving parsing to write time (alongside the per-ticket EAV redesign
above) collapses these into one writer-side helper that all consumers
read.

### Additional VCS providers

`VCSProviderType` enumerates `GITHUB` / `BITBUCKET_CLOUD` /
`BITBUCKET_SERVER`, but only **Bitbucket Server** is implemented — the
commit-range controller hard-rejects anything else ("only
BITBUCKET_SERVER supported in v1") and the wizard shows GitHub /
Bitbucket Cloud as disabled "Coming soon" cards.

## Prod data fixes / known TODOs

These are data cleanups / known limitations for prod. None block this
feature; recording them so they don't get lost.

### Remove the dev autostub branch before wide rollout

`commitAnalysisService` synthesizes stub dev-tickets when
`RELEASE_AUTOSTUB_MISSING_TICKETS=1` (double-guarded by
`NODE_ENV !== 'production'`) so local ART rows resolve when PR titles
reference prod XYNE ids absent locally. Marked TODO-remove-before-ship —
it is a local-dev convenience only. `cleanup-autostub-tickets.ts --delete`
removes leftover stubs.

### `entityType` casing inconsistency

Prod's `form_entity_values.entityType` has both `Ticket` (~17k rows) and
`TICKET` (~37k rows). Different code paths inserted with different
casings. One-time normalization needed before any code relies on
consistent casing.

```sql
UPDATE form_entity_values
SET "entityType" = 'TICKET'
WHERE "entityType" = 'Ticket';
```

### `Application.envPaths` / `migrationPaths` backfill

`ChangeDetector` categorizes files purely from each `Application`'s
configured `envPaths` / `migrationPaths` — there are **no hardcoded
default patterns**. `matchesPattern` uses `patterns.some(...)`
(`includes`/`endsWith`), so an app whose paths are empty (the column
default is `[]`) captures **zero** env and migration changes, silently,
with no error.

New apps configured through the wizard set these. **Pre-existing
`Application` rows (created before this feature) have empty arrays and
must be backfilled** with their env/migration globs, or their changes
won't surface. The legacy Xyne app's historical defaults were `env.ts`,
`.env`, `.env.local`, `.env.example` (env) and
`backend/prisma/migrations/`, `backend/prisma/schema.prisma` (migration).

### Legacy ownership backfill (`mainReleaseBoardId` / board VCS config)

Pre-v2 apps have NULL `mainReleaseBoardId` (invisible to ownership
queries) and pre-v2 main boards have NULL `vcsProvider` /
`releaseTrackingMode` (the edit-config wizard rejects them). Run
`backfill-legacy-release-ownership.sql` once to fix both. Idempotent.

### Legacy `changeLog` rows with diff noise

This feature strips git-diff metadata and `+`/`-` markers at write time.
Old rows in prod still contain the raw diff. **Decision: leave legacy
rows as-is.** The dashboard's `cleanDiff` continues to handle them at
render time (idempotent on already-clean strings). If a one-time
backfill is ever wanted, sketch a `regexp_replace` UPDATE against the
`changeLog` field — verify the regex on a sample first.

### `contextId` backfill check

Local DB needed a `contextId` backfill during v2 because the writer used
to drop the field. Prod may have the same gap for legacy release-form
rows. Verify:

```sql
SELECT COUNT(*) FROM form_entity_values
WHERE "entityType" IN ('RELEASE_ENV_FORM','RELEASE_MIGRATION_FORM')
  AND "contextId" IS NULL;
```

If non-zero, backfill `contextId` from `release_change_types.releaseId`
(joining `form_entity_values.entityId = release_change_types.id`).

### Legacy `release_change_types` rows with NULL linkage

Pre-v2 rows have all linkage columns (`releaseId`, `applicationReleaseId`,
`devTicketXyneId`, `commitId`, `filePath`) NULL. Release-scoped reads
filter `releaseId IS NOT NULL`, so these are simply ignored — no action
required.
