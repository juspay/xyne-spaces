# Ticket dependency validation

The feature is not ready for release. Keep `TICKET_DEPENDENCIES_ENFORCEMENT_READY` false and PR #3710 draft.

## Run the checks

From `apps/backend`:

- `pnpm test:ticket-dependency-transport`
- `pnpm test:ticket-dependency-stage-db`
- `pnpm test:ticket-dependency-compatibility`
- `pnpm typecheck`

The SQL suite requires PostgreSQL and permission to create an isolated schema. It never truncates application tables. It drops its disposable schema on completion and does not silently skip missing configuration. The default database must be localhost. Remote CI requires an explicit `TICKET_DEPENDENCY_TEST_DATABASE_URL` pointing to a disposable test database.

## What each check establishes

| Check | Evidence | Does not establish |
| --- | --- | --- |
| Shared policy tests | Pure gate, satisfaction, graph and state rules | Application authorization or delivery |
| Transport and ACL tests | Input schemas, restricted projections, sync exclusions and private audit ACL denial | Live workspace grant revocation |
| Prisma boundary tests | ACL checks precede the dependency continuation, scoped bulk predicates survive, existing transaction context reaches the guard | A live Prisma engine write with production ACLs |
| SQL transaction tests | Independent PostgreSQL connections, mixed graph lock contention, gate decisions, latches, rollback, private audit storage and migration SQL | A registered application mutator, authorization or synchronization |
| Compatibility tests | Legacy reference mutation behavior | Every importer, merge, integration or deletion path |
| Typechecks | Backend and dashboard contract compatibility | User-visible acceptance |

The SQL suite also checks rollback through the real Prisma SQL adapter and an installed Zero server CRUD mutation, each on its own real transaction against isolated tables. A real Prisma engine transaction verifies callback-to-guard wiring with its model query short-circuited; it does not read or write application rows. This is not an application mutator, live authorization or synchronization test.

## Implemented server checkpoint

The transaction helper checks gates and writes latches, private overrides and redacted activities on the caller's connection. It rereads the persisted ticket before lifecycle effects so a conditional no-op cannot fabricate a transition. FLOW ignores incoming gates. Human overrides require a reason; hard overrides additionally reauthorize board administration.

Prisma enforcement runs only through the final ACL-approved continuation. Middleware must not redirect writes: Prisma middleware executes before query extensions. Interactive transaction callback clients receive a connection-marking ticket proxy and keep their existing caller-authorization contract. They reuse their existing connection. Stage writes through a global client inside a callback fail closed rather than execute on another connection. Unsupported transaction shapes and stage-changing upserts fail closed once the readiness interlock is enabled.

The private audit migration preserves historical CHILD override authors and reasons before clearing replicated columns. Generic user ACLs deny private audit access. The private table is excluded from Zero generation; the runtime CHILD schema also excludes override author, reason and timestamp.

Required flag evaluation uses OpenFeature details. Errors and default fallbacks are not explicit permission to disable enforcement. Other flag consumers retain their existing fallback behavior.

## Remaining release requirements

- audit and cover every writer, including approval execution, REST and SDK options, nested Prisma writes, raw SQL, bulk writes and integrations
- prove real Prisma and Zero authorization, live revocation, board-administrator grant scope and concurrent edits
- bound workspace graph scans and evaluate bulk moves against their atomic final state
- finish richer transition and ETA context, merge repointing, cancellation and deletion behavior, idempotent notifications and risk watching
- complete policy settings, gate dialogs, activity rendering, filters, highlighting and shared calendar saved-view definitions; the dashboard dependency editor, shared badges and Created/ETA grouping now have focused tests, not browser acceptance
- finish Jira mapping, export and MCP compatibility
- complete real application end-to-end acceptance; command footage and isolated SQL tests do not count

Do not enable the readiness interlock to make tests pass. Deploy nullable metadata and private audit migrations before any eventual activation. Retain the private audit table and keep the feature disabled during an application rollback; do not restore private text to replicated columns.
