# XYNE-67487: dependency foundations

This branch implements the PRD's shared rules and nullable schema expansion, plus
compatibility guards. **It does not implement the end-to-end dependency feature.**
No dependency CRUD endpoint, stage gate enforcement, state hook, badge or board
policy UI is enabled. Existing relationship access rules are unchanged.

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

## Required follow-up before enabling anything

1. Resolve restricted-ticket transport. The PRD requests target-side visibility of
   BLOCKS rows and no inaccessible-ticket id disclosure. A raw synced mapping still
   carries both endpoint ids. Do not widen the existing ACL and rely on hiding the
   title in React. Provide an authorized server-redacted dependency representation
   for restricted endpoints; keep normal ticket access unchanged. Audit activity,
   thread messages, notifications and cycle/gate error payloads as well.
2. Implement transactional dependency writes with same-workspace/read-both/edit-one
   checks, board-stage validation, duplicate/self checks and the shared advisory
   lock. Extend sub-ticket cycle validation under that same lock. Do not introduce
   an alternate unguarded writer.
3. Integrate the gate in every PRD-listed stage writer and add a stage-writer
   allowlist test. Persist soft/admin override reasons atomically with the move.
   Add idempotent after-commit satisfaction/review/ETA-flip handling, merge
   repointing and parent cancellation handling.
4. Add the batched state hook, shared components, all ticket-view integrations,
   calendar Created/ETA preference, filters, board policy and notifications.
   Map Jira blocks-link directions without changing existing import mappings.
5. Add the `ticket_dependencies_v1` backend/dashboard flags and end-to-end tests
   covering unreadable endpoints, workspace/guest isolation, concurrent mixed
   cycles, all stage-changing entry points and existing relationship behavior.

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
