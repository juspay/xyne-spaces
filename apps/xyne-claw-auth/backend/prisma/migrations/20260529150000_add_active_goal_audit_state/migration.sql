-- Add audit-pass state machine to active_goals.
--
-- When the boss judge in goalRelooper.recordTurnAndDecide votes done in
-- "none" state, we no longer terminate immediately. Instead we set the
-- state to "pending", fire one extra AUDIT turn, and wait for the worker
-- to either (a) emit GOAL_REOPEN with a list of errors → switch back to
-- "done" and continue with a FIX task, or (b) emit a clean reflection →
-- terminate.
--
-- Defends against the LLM-judge weakness where the judge approves a
-- well-formed but factually incorrect worker output (the May-27 Euler
-- Dispatch report claimed 58 PRs created; reality was 27).
--
-- States: "none" | "pending" | "done"
-- Default is "none" so existing active goals continue under the old
-- judge-then-terminate semantics until the next /goal.

ALTER TABLE "active_goals"
    ADD COLUMN IF NOT EXISTS "auditState" TEXT NOT NULL DEFAULT 'none';
