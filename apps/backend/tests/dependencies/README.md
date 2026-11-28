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
| HTTP context tests | Authenticated identity, asynchronous propagation, strict override input and count-only errors | Real REST/SDK routing, atomic multi-service updates or application ACLs |
| Prisma boundary tests | ACL checks precede the dependency continuation, scoped bulk predicates survive, existing transaction context reaches the guard | A live Prisma engine write with production ACLs |
| Nested writer shape tests | Generated Prisma relation traversal, nested ticket-stage and board-policy refusals, inverse board reassignment, relational board-connect classification, JSON/predicate isolation and disabled-stage compatibility | A live nested Prisma engine write, every raw/bypass writer or complete lifecycle coverage |
| SQL transaction tests | Independent PostgreSQL connections, mixed graph lock contention, gate decisions, latches, rollback, private audit storage and migration SQL | A registered application mutator, authorization or synchronization |
| Compatibility tests | Legacy reference mutation behavior | Every importer, merge, integration or deletion path |
| Typechecks | Backend and dashboard contract compatibility | User-visible acceptance |

The SQL suite also checks rollback through the real Prisma SQL adapter and an installed Zero server CRUD mutation, each on its own real transaction against isolated tables. A real Prisma engine transaction verifies callback-to-guard wiring with its model query short-circuited; it does not read or write application rows. This is not an application mutator, live authorization or synchronization test.

## Implemented server checkpoint

The transaction helper checks gates and writes latches, private overrides and redacted activities on the caller's connection. It rereads the persisted ticket before lifecycle effects so a conditional no-op cannot fabricate a transition. FLOW ignores incoming gates. Human overrides require a reason; hard overrides additionally reauthorize board administration.

Prisma enforcement runs only through the final ACL-approved continuation. Middleware must not redirect writes: Prisma middleware executes before query extensions. Interactive transaction callback clients receive a connection-marking ticket proxy and keep their existing caller-authorization contract. They reuse their existing connection. Stage writes through a global client inside a callback fail closed rather than execute on another connection. Unsupported transaction shapes and stage-changing upserts fail closed once the readiness interlock is enabled.

The private audit migration preserves historical CHILD override authors and reasons before clearing replicated columns. Generic user ACLs deny private audit access. The private table is excluded from Zero generation; the runtime CHILD schema also excludes override author, reason and timestamp.

Required flag evaluation uses OpenFeature details. Errors and default fallbacks are not explicit permission to disable enforcement. Other flag consumers retain their existing fallback behavior.

## Reapplied continuation checkpoint

- Dependency errors carry only gate counts and live admin eligibility through Zero ApplicationError details. Nested override intent survives the shared encryption contract and registered ticket update validators; malformed/ambiguous intent is refused. This does not establish all-writer UI propagation.
- BLOCKS and CHILD author/reason values are cleared from mapping stamps; audit text remains private. Automation audit reasons are exactly `automation`; service/system identity and data.updatedBy do not establish automation provenance.
- Cycle validation walks the incident unsatisfied component in 200-ID frontiers. Graph/context reads fail closed beyond 10,000 nodes or 20,000 rows, and empty explicit selections never scan the workspace. Prisma updateMany refuses more than 100 targets; the continuation below adds final-state bulk SQL tests, not registered application acceptance.
- Zero board policy changes recheck live administration before creator/project shortcuts. Prisma board policy enforcement is implemented in the continuation below; real grant-revocation acceptance remains outstanding.
- Isolated Prisma rollback tests use the existing SQL adapter, not new raw-query calls. The raw SQL guard is unchanged.

## Consent, bulk and policy continuation

- Shared stage intent and the mounted dashboard host implement one explicit retry, private trimmed reasons, live eligible hard consent, rollback before prompting and cancellation on identity/workspace/intent replacement or unmount. Isolated controller/jsdom tests are not browser acceptance.
- The bulk server mutator preauthorizes every selected target, then composes existing registered writers on one transaction. Final-state preflight and persisted-state validation reject approval-only/no-op outcomes. Nested lifecycle stamps are deduplicated within that bulk operation; normal authorization and encryption wrappers remain in place.
- Prisma and Zero policy changes serialize with graph writers and check live board administration. The feature-gated board editor preserves other metadata and maps new stage IDs. SQL tests cover authority/reset/revocation; the actual board editor still needs application acceptance.
- REST PATCH and SDK update handlers propagate authenticated override intent and typed count-only errors. SDK request logging no longer records the reason-bearing body. **These handlers still call multiple service writes: a later refused stage/status operation may follow an already-committed unrelated update. Atomic request-level behavior and every writer remain release blockers.**
- Jira stale-link cleanup preserves application-owned BLOCKS mappings. This is not complete Jira import/export acceptance.

## Nested-writer continuation

- The final ACL-approved continuation checks schema-declared nested relation writes. Covered nested ticket stage/status/board/archive/ETA updates and inverse `Board.tickets` connections fail closed when the readiness interlock is enabled. Existing disabled-stage writers remain unchanged. Nested board metadata edits must use an explicit board update, including while ticket enforcement is disabled, so a nested write cannot evade the board-policy authorization guard.
- A direct `Ticket.board.connect` is classified as a board move on the original guarded transaction. Arguments are not rewritten. Ambiguous board destinations fail closed without echoing input.
- Sub-ticket controller failures now use the existing typed dependency HTTP response, preserving cycle/busy/flag-unavailable statuses rather than turning them into generic server failures. The transport unit tests do not establish live controller/service integration.
- Focused transport/ACL/boundary/HTTP/shape tests passed (59), legacy compatibility passed (10), and the isolated PostgreSQL transaction suite passed (29). Source-file ESLint passed; the test files are ignored by the configured lint command. An explicit `--no-ignore` attempt failed because the backend lint tsconfig excludes these tests; test-file lint is not established. No live application or browser acceptance is claimed.
- Initial backend typechecks used a stale generated Prisma client and failed on dependency metadata/private-audit types. The client was regenerated and the final backend typecheck passed. Regeneration is required after applying this branch's schema changes.
- Full backend `pnpm build` remains blocked by the unchanged ACL-bypass prebuild guard. It flags existing callback-taking helpers, including `dependencyTicketWrite`, `dependencyBoardPolicyWrite` and `dependencyBulkStageWrite`. No guard was relaxed. This is a release blocker, not a passing build or a reason to enable the feature.

## Remaining release requirements

- audit and cover every writer, including approval execution, REST and SDK options, nested Prisma writes, raw SQL, bulk writes and integrations
- prove real Prisma and Zero authorization, live revocation, board-administrator grant scope and concurrent edits
- validate graph bounds against production-shaped data and evaluate bulk moves against their atomic final state
- finish richer transition and ETA context, merge repointing, cancellation and deletion behavior, idempotent notifications and risk watching
- complete policy/gate application acceptance, activity rendering, filters, highlighting and shared calendar saved-view definitions; the dashboard dependency editor, shared badges and Created/ETA grouping now have focused tests, not browser acceptance
- finish Jira mapping, export and MCP compatibility
- complete real application end-to-end acceptance; command footage and isolated SQL tests do not count

Do not enable the readiness interlock to make tests pass. Deploy nullable metadata and private audit migrations before any eventual activation. Retain the private audit table and keep the feature disabled during an application rollback; do not restore private text to replicated columns.
