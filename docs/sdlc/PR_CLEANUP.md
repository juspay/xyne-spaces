# SDLC PR Cleanup

Track changes to remove or revise before promoting the SDLC production PR.

## Pending

None.

## Completed

### `apps/backend/src/controllers/ticketController.ts`

- Restored the file from `origin/main` so formatting-only changes disappear from the PR.
- No behavior change intended.
- Verified there is no diff from `origin/main` for this file.

### `apps/backend/src/database/repositories/pullRequestsRepository.ts`

- Removed the SDLC-specific ticket update from `markMergedPr` that hardcoded
  `stageName: 'Done'` and `statusV2: 'COMPLETED'`.
- `PRTicketStatusSyncService` now resolves the board-configured stage for the
  `MERGED` event.
- SDLC polling reconciliation now invokes the same status-sync path as provider
  webhooks when it discovers a merged PR.
- This supports SDLC tickets on any board; `Done` may not exist, and the
  direct database update bypasses normal stage validation, activity,
  notification, and Flow-cascade behavior.
- Kept the relaxed `PRStatusUpdateProps` input type.
- Verified with backend typechecking and the focused SDLC reconciliation test.
