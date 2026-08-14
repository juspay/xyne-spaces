-- Adds an optional wall-clock budget (milliseconds) to active goals.
-- Nullable + no default: existing rows keep NULL (no time cap), so this is a
-- backward-compatible additive change. Enforced by the relooper alongside
-- maxTurns as the second mandatory ceiling for user-configured loops.
ALTER TABLE "active_goals" ADD COLUMN "maxWallClockMs" INTEGER;
