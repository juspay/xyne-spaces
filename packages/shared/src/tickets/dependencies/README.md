# XYNE-67487: dependency foundations

This branch implements shared rules, nullable schema expansion, compatibility guards
and disabled server scaffolding. **It does not implement the end-to-end dependency feature.**
No dependency API, stage gate enforcement, state hook, badge or board policy UI is
**enabled**. Dedicated API routes exist but authorized requests return 404 while
`TICKET_DEPENDENCIES_ENFORCEMENT_READY` is false. Turning on the remote flag alone
cannot enable the feature. Legacy reference access remains source-ticket scoped;
raw BLOCKS rows are explicitly excluded from Zero and request-scoped Prisma reads.

## Rule contracts

- `toEdges` normalizes only BLOCKS references and mapped sub-ticket rows. Other
  reference types and unmapped sub-tickets are not dependency edges. It never
  changes input rows; null legacy fields mean soft strength and terminal gating.
- `lockedStageIds`, `meetsSatisfiedWhen`, `effectiveStrength` and `dependencyGate`
  are pure classifiers. The caller owns authorization, transaction boundaries,
  overrides and latch persistence. They cannot enforce a stage change on their own.
- `deriveDependencyState` consumes an explicit `DependencyContext`: board types,
  metadata policy, stage ordering, current-visit ETA and authorized NON_LINEAR
  outgoing transitions cannot be inferred from ticket/stage ids alone. Dates accept
  Prisma dates, Zero millisecond timestamps or ISO strings. Durations use hours.
- `findCycle` checks combined BLOCKS and CHILD edges on stage nodes, with ordered
  progress on DEFAULT/RELEASE and collapsed ticket nodes for NON_LINEAR. It replaces
  the candidate's previous edge on edit, ignores latched edges, and is iterative.
  The server must provide complete graph context under the existing workspace
  sub-ticket advisory lock. A client-side check is never sufficient.
- `assertGenericTicketReference` protects create/update/delete, including conversion
  to or from BLOCKS, in both optimistic and server reference mutators. Existing
  relationship types retain their current path. The add-link check ignores BLOCKS.

The returned edge objects and cycle ticket ids are **internal data**, not a safe
API response for an arbitrary viewer. A missing related ticket does not erase an
edge from gate/state calculations, but also does not establish its read permission.

## Disabled server scaffolding

- Dedicated dependency create/edit/delete/manual-satisfaction and child-gating
  routes use strict input schemas. Workspace and author identity come from the
  authenticated request, not request data. Child gating rejects a satisfaction
  stage rather than accepting and silently ignoring it.
- Mutations re-resolve workspace role inside a bypass transaction, require both
  endpoints readable and at least one editable, check resource WRITE/ADMIN grants,
  validate board/stage ownership, and use the existing workspace sub-ticket
  advisory lock for combined graph checks. Child gating additionally requires
  parent edit permission. These paths still require live authorization tests.
- The batched read computes state server-side, applies the ticket ACL and returns
  explicit allow-listed fields. Restricted endpoints get placeholders; their stage
  ids and free-text override attribution/reasons are omitted. Even legacy mapping
  ids can encode a ticket id, so restricted edges use opaque HMAC identifiers scoped
  to workspace and viewer. State edge references use those same public ids.
- Raw Zero reference CRUD refuses BLOCKS and conversions to/from BLOCKS. Activities
  and thread messages use generic text and never name the other endpoint. The
  historical child-tree validator stays unchanged while enforcement is unready.
- Context loading indexes stages, transitions and active visits instead of scanning
  them separately for every ticket. Missing graph endpoints fail closed with a
  generic error, not a path or ticket id.

## Required follow-up before enabling anything

1. Integrate gates atomically in **every** stage writer and add an entry-point
   allow-list regression test. Persist soft/admin override reasons with the move.
   Audit generic Prisma/system writers and child-mapping mutations for bypasses.
2. Finish automatic satisfaction/review/ETA-flip effects, merge repointing, parent
   cancellation and notifications; make after-commit delivery retry-safe.
3. Add the batched state hook, shared components, all requested ticket views,
   calendar Created/ETA preference, filters and board policy controls. Map Jira
   blocks-link directions without changing other import mappings.
4. Validate actual database ACL behavior, workspace/guest/resource revocations,
   concurrent mixed cycles, restricted CHILD transport, activity audiences and
   Streamgres synchronization. Mocked transaction and projection tests are not
   authorization or concurrency acceptance tests.
5. Complete backend/dashboard flag rollout and genuine product UI E2E/POT. Only
   then remove the enforcement interlock. Keep the PR draft until these pass.

## Schema rollout

Apply the expand-only Prisma migration before deploying the new Zero schema and
regenerate Prisma clients as part of the normal build. The migration adds nullable
columns and indexes, never backfills or rewrites existing relationships. Validate
index-build duration/locking on a representative staging dataset before production.
Validate the schema rollout with the deployed Streamgres/Zero version; the isolated
SQL smoke test is not proof of live-sync DDL compatibility.

To roll application code back, leave the nullable columns and indexes in place.
Do not drop them while any running clients/workers reference the expanded schema.
Do not import or create BLOCKS rows until their dedicated writers, privacy-safe
reads, effects and feature-flagged gates are implemented and tested together.

## Validation commands

```sh
pnpm --filter @xyne/shared build
(cd packages/shared && node --test test/*.test.mjs)
pnpm --filter xyne-spaces-backend test:ticket-dependency-compatibility
pnpm --filter xyne-spaces-backend test:ticket-dependency-transport
DATABASE_URL=postgresql://validation:validation@localhost:5432/validation \
  pnpm --filter xyne-spaces-backend exec prisma validate --schema prisma/schema.prisma
pnpm --filter xyne-spaces-backend typecheck
pnpm --filter xyne-spaces-dashboard typecheck
```

The rule tests are pure unit tests. The reference-mutator tests exercise actual
optimistic mutator functions against a minimal mocked transaction, not a live Zero
server or an authorization policy. Migration SQL was smoke-tested on disposable
PostgreSQL tables seeded with all four legacy reference types and a child mapping;
legacy values stayed intact and a BLOCKS row coexisted with LINKED for the same pair.
No production database or workspace data was modified.

The server-scaffolding tests exercise projection allow-lists, opaque-id replacement,
strict request schemas, graph/context adapters, missing-endpoint errors and actual
Zero ACL early-rejection methods against mocked transactions/query builders. They
do not execute the controller, feature-flag service, Prisma ACL SQL, a live Zero
mutation, transaction contention or a user-visible stage move. UI acceptance remains
unmet; no test-output recording should be described as a product walkthrough.

The transport suite loads normal backend configuration via `.env.local` (or inherited
CI environment) because the server Zero query registry imports configuration. Its
unused text-hashing key has a deterministic test-only fallback; no tokens are minted
and no database connection is made by these tests.
