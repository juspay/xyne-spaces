# Ticket dependency dashboard integration

The feature remains disabled by the backend readiness interlock. Frontend
PostHog visibility is not permission to enable backend enforcement. Do not
enable the interlock for demonstration or testing.

## Ownership and privacy

The REST read computes states on the server before redacting endpoints. The
dashboard never requests raw BLOCKS through Zero and never recomputes states
from a partial graph. A workspace/user-scoped store coalesces active
subscriptions into serial batches of at most 200 tickets. It refreshes on
successful local dependency changes, visible-page polling, focus and
connectivity recovery.

Each cached ticket view contains only that ticket and its incident dependency
endpoints, not unrelated titles from the shared response. Releasing the last
subscription aborts reads and drops its cache. Read failures replace cached data
with empty views. An explicitly restricted edge always renders
`Restricted ticket`, even if a stale endpoint summary is present. Auth/workspace
switches remount editor state so selected tickets and private reasons are not
reused across identities.

Private override authors and reasons are not displayed in badges, hover content,
or relationship rows. Textareas opt out of PostHog capture. Permission, graph,
policy and stage validation remain server-authoritative. The editor displays
configured strength: board policy can harden it.

## Implemented surfaces

- Ticket details: BLOCKS creation in either direction, stage/strength settings,
  CHILD gating settings, delete and Needs-review satisfaction confirmations,
  required hard-change reason input, and Also-linked deduplication without
  changing legacy relationship storage.
- Header, kanban/chat cards, both list rows and calendar badges: shared state
  presentation with click/keyboard disclosure and hover content.
- Calendar month/week/day/modal: Created (default) and ETA grouping without
  modifying creation timestamps; ETA mode omits undated tickets. Preferences use
  the existing user-preference actor, scoped by workspace and optional
  saved-view key. Existing callers still use the workspace default until they
  pass stable saved-view IDs.

## Validation

From `apps/dashboard`:

- `pnpm typecheck`
- `pnpm exec vitest run src/services/dependencies/__tests__ src/components/Tickets/Dependencies/Dependencies.test.tsx src/components/Tickets/CalendarView/dateGrouping.test.ts src/components/Tickets/CalendarView/CalendarView/CalendarView.test.tsx --maxWorkers=1`

The focused tests cover batching, serial chunking, reference counts,
invalidation, abort/rejoin, failure cache clearing, isolated stores, REST
payloads, static privacy rendering and Created/ETA grouping. Dependency components
are rendered statically. The No ETA tray has a mounted jsdom contract test with
mocked auth, preferences, badges and date views; it proves collapse/expand/open
behavior and feature/Created-mode hiding, not browser or application acceptance. Store isolation tests do
not prove live application authorization, hook StrictMode behavior or grant
revocation.

The broader dashboard Vitest suite was also attempted. Its existing
stream-manager cleanup suite fails during setup because the window stub has no
`location.protocol`; activity visibility fails its missed-call expectation. Both
failures reproduce when running the untouched suites with the checkpoint's
original Vitest configuration. They were not suppressed or fixed in this feature
change. Full repository lint and browser acceptance are separate outstanding
checks.

## Reapplied calendar continuation

ETA mode now includes a collapsed No ETA tray. It preserves access to absent or
invalid-date tickets and their ordinary open action; epoch zero stays a dated
ticket. Created mode and feature-off behavior omit the tray. No ticket dates,
shared saved views, or authorization rules are changed.

## Stage consent and board policy continuation

The application mounts one identity-owned dependency consent host. Ticket details, the stage
picker, inline table moves and linear/non-linear drag-and-drop use one authoritative retry.
Private reasons are excluded from analytics; hard consent begins unchecked and requires live
server eligibility. Separate DnD state is restored before prompting. Cancellation suppresses
success callbacks and analytics. Mounted jsdom tests mock identity and UI primitives; they do
not prove real ACL, encrypted writes, focus or synchronization.

Feature-enabled table bulk stage changes use the bounded atomic server mutator; unrelated
field updates run only after accepted stage completion. Board settings expose default strength,
automation behavior and hard stages, retaining unrelated metadata and generated stage IDs.
These surfaces still require application acceptance before enabling enforcement.

## Still required before release

- Finish stage option propagation and application acceptance through every writer,
  including non-linear forms, approvals and REST/SDK multi-write atomicity.
- Board policy application acceptance, dependency filters, related-ticket highlighting and
  specialized activity rendering.
- Merge/cancellation/deletion lifecycle behavior, notifications, risk watcher,
  Jira/export/MCP compatibility and production-shaped graph-bound acceptance.
- Actual application authorization/revocation, mobile/desktop interaction,
  keyboard/focus, sync and end-to-end concurrency acceptance.

These are implementation and acceptance gaps, not a request to enable the
feature. Keep PR #3710 draft.
