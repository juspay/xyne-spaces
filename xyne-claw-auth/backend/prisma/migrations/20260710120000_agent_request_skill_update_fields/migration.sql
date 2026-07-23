-- Skill-update proposals reuse the existing `agent_requests` table
-- (targetType='skill', requestType='skill_update') rather than a new table,
-- mirroring how clone requests are modelled. These four nullable columns hold
-- the proposal payload server-side so the signed approval card only carries the
-- requestId:
--   proposedContent      — the proposer's full replacement markdown (Text)
--   baseContentHash      — sha256 of the content the proposer diffed against
--                          (optimistic-concurrency check at approve time)
--   proposedContentHash  — sha256 of proposedContent (integrity check on apply)
--   requestNote          — proposer's free-text "what changed and why"
-- All are nullable and unused by every other requestType, so this is a purely
-- additive, backward-compatible change (no backfill, no rewrite).
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "proposedContent" TEXT;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "baseContentHash" TEXT;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "proposedContentHash" TEXT;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "requestNote" TEXT;
