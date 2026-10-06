# Legacy collection queue cutover (temporary)

Collection moved from one Bull queue (`slack-migration-collection`) to one per workspace
(`slack-migration-collection--<workspaceId>`). The commit that added this file moves jobs still waiting
on the old queue onto their workspace queue. It is only needed while the deploy settles — then revert it.

## What it does

- On every reconcile tick (leader only, every 60s) `drainLegacyCollection()` moves the old queue's waiting
  jobs onto their workspace queue, in the same order and ahead of jobs already there.
- A job that was deleted, or has already left collection, is dropped from the old queue. Only the queue
  entry (the job id) is removed — the job record and its GCS data are never touched.
- Logs `[SlackMigration] moved jobs from the legacy collection queue` with the count when it moves anything.
- The job that was running at deploy time is not in the waiting list; reconcile re-queues it at the front
  of its workspace queue (that part is permanent code, not this commit).

## When it is safe to revert

All of these must hold:

1. Every migration pod runs this release or later (no pod on the pre-workspace image, and no rollback planned).
2. The old queue has nothing waiting:
   ```
   LLEN bull:slack-migration-collection:wait     → 0
   LLEN bull:slack-migration-collection:paused   → 0
   ```
3. No `moved jobs from the legacy collection queue` log since the rollout finished.

## How to revert

```
git log --oneline -1 -- apps/backend/src/migration/self-serve/LEGACY_QUEUE_CUTOVER.md   # the commit to revert
git revert <that sha>
```

This removes `MigrationQueues.moveWaiting` (queues.ts), `LEGACY_COLLECTION_QUEUE`, `drainLegacyCollection()`
and its call in `reconcile()` (workers.ts), and this file. Nothing else uses them.

## Leftover

`bull:slack-migration-collection:active` may still hold the id of the job that was running at deploy time.
Reconcile has already re-queued that job on its workspace queue, so the entry is inert; it can stay or be deleted.
