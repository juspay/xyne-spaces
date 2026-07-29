# Jobs & Background Processing Guide

Background jobs using Bull queues with Redis. Located in `src/queues/` and `src/workers/`.

---

## Existing Queues

| Queue | Location | Schedule | Purpose |
|-------|----------|----------|---------|
| `vespa-ingestion` | `vespaQueue.ts` | On-demand | Vespa document indexing (failures stored in `VespaFailure` table for retry) |
| `eta-deadline-check` | `etaDeadlineQueue.ts` | Daily (midnight) | Check ticket ETA deadlines |
| `presence-cleanup` | `presenceCleanupQueue.ts` | Every 5 min | Mark inactive users offline |
| `assignment-reactivation` | `assignmentReactivationQueue.ts` | Delayed | Reactivate user assignments |
| `metrics-sync` | `metricsSyncQueue.ts` | Hourly/48h | Sync message/user/call counts |
| `personalization-sync` | `workers/index.ts` | Every 6 hours | Sync user personalization |
| `product-insights` | `workers/index.ts` | On-demand | Product insights clustering |

---

## When to Create a Job

**DO create a job for:**
- Operations that take > 500ms
- Tasks that can fail and need retries
- Scheduled/recurring tasks
- Tasks that shouldn't block HTTP requests
- Operations that need rate limiting
- Tasks that need to run after a delay

**DON'T create a job for:**
- Simple CRUD operations
- Fast synchronous operations
- Operations that need immediate response
- One-off scripts (use manual migrations instead)

---

## Job Frequency Guidelines

**Never run jobs more frequently than every 5 minutes unless absolutely necessary.**

---

## Redis Configuration

**Always use `redisService.getRedisConfig()` for Bull queues. Never create Redis config directly.**

Import from `@/services/redisService` and pass to Bull queue constructor.

---

## Queue Structure

Each queue should follow the singleton pattern with:
- `initialize()` method with initialization guards
- Use `redisService.getRedisConfig()` for Redis connection
- `setupProcessor()` for job processing logic
- `setupEventListeners()` for completed/failed/stalled events

**Location:** Create new queues in `src/queues/` directory.

## Job Types

### On-Demand Jobs
Jobs triggered by application events. Add with optional delay, priority, or unique jobId.

### Repeatable Jobs (Scheduled)
Jobs that run on a schedule using cron expressions or fixed intervals.

### Delayed Jobs
Jobs that run after a specific timestamp. Use unique jobId for cancellation.

---

## Best Practices

1. **Idempotency** - Jobs may run multiple times. Make operations idempotent.

2. **Job Deduplication** - Use unique `jobId` to prevent duplicate jobs.

3. **Cleanup Repeatable Jobs** - Remove old repeatable jobs before scheduling new ones to avoid duplicates.

4. **Graceful Shutdown** - Close queues on application shutdown.

5. **Monitor Queue Health** - Check waiting/active/failed job counts periodically.

6. **Small Payloads** - Store IDs in job data, fetch full data in worker.

7. **Vespa Failures** - For Vespa-related operations, store failures in the `VespaFailure` database table for later retry instead of relying solely on Bull's retry mechanism. This ensures persistent tracking of failures across restarts.

---

## Anti-Patterns

- Running jobs every second/minute without strong justification
- Storing large payloads in job data
- Not handling errors (jobs will be lost)
- Creating queues in request handlers (use singleton)
- Blocking the event loop in workers
- Ignoring stalled jobs
- Creating Redis config directly instead of using `redisService`

---

## Queue Registration

Initialize queues in app startup by calling `initialize()` on each queue instance.
