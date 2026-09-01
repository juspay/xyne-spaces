# Slice 3 deletion ledger — run-queue migration

Delete only after `XYNE_RUN_QUEUE=1` has held parity in prod (~1 week:
`run_queue_enqueued ≈ claimed ≈ completed + rescheduled`, no `handoff_callback_lost`,
no runs stuck `running`).

## claw (apps/xyne-claw)

- `src/handoff-redis.ts` — entire file (Redis handoff signal channel)
- `src/routes/run.ts` — `sendHandoffCallback` + the handoff branch that calls it;
  `requestActiveRunHandoffs` + `handoffControl` cap-timer machinery;
  `XYNE_DRAIN_HANDOFF` flag in `main.ts` shutdown
- HTTP dispatch surface of `/run` legacy JSON mode once no caller remains
  (verify: webhook + all claw-auth self-POSTing workers migrated or flag-dead)

## claw-auth (apps/xyne-claw-auth/backend)

- `src/queue/run-recovery-worker.ts` — `startHandoffSignalConsumer`,
  `handleRunHandoff` + its gate chain, watchdog `/alive` probes
  (`isRunStillExecuting`), `registerRunRecovery` on the mention path
  (the queue job IS the durable payload)
- `src/services/orphan-finalizer-worker.ts` — entire file (leases replace it;
  currently disabled in prod via `ORPHAN_FINALIZER_ENABLED=false` anyway)
- `src/lib/claw-fetch.ts` — entire file (`fetchClawRunWithRetry`,
  `isTransientUpstream`) once `httpForwardRun` in `start-run.ts` is deleted
- `src/routes/webhook.ts` — the transient-upstream arm of the dispatch-refusal
  notice (unreachable once dispatch = enqueue)
- `src/lib/dispatch-run.ts` — collapse to enqueue-only; `httpDispatch` option
  and the flag check go
- The global twin concurrency limiter (`acquireTwinSlot` poll-and-drop) —
  superseded by queue backpressure + pressure admission (verify twin fan-out
  volume first)

## Config / flags

- `XYNE_RUN_QUEUE` (both services) — flag becomes the only mode; delete reads
- `XYNE_DRAIN_HANDOFF`, `RUN_RECOVERY_PURGE_ON_START` (if recovery registration
  is fully retired)

## Keep (not part of this migration)

- NX result markers / `runAlreadyCompleted` (exactly-once posting)
- GCS session flush/restore + turn-boundary checkpointing
- Conversation session locks; per-user twin FIFO (`tryAcquireSlot`)
- `run-ownership.ts` fencing (queue-native, stays)
- S2S automation webhook route
