-- Add active_goals table for the /goal autonomous-loop feature.
--
-- One UNIQUE row per Spaces conversationId, created when a user types
-- `/goal <condition>` in a thread. The relooper in xyne-claw-auth
-- (src/services/goalRelooper.ts) reads runPayload to refire claw's /run
-- on each subsequent loop turn; the boss judge in xyne-claw
-- (src/goal-judge.ts) decides when the loop terminates.
--
-- Status transitions: active → done | cancelled | failed. Terminated rows
-- are kept (no soft-delete) for audit; index on (status, updatedAt) keeps
-- "active goals" lookups cheap.

CREATE TABLE IF NOT EXISTS "active_goals" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "workspaceId" TEXT,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "maxTurns" INTEGER NOT NULL DEFAULT 20,
    "lastTurnResult" TEXT,
    "lastReason" TEXT,
    "runPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "active_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "active_goals_conversationId_key"
    ON "active_goals"("conversationId");

CREATE INDEX IF NOT EXISTS "active_goals_userId_status_idx"
    ON "active_goals"("userId", "status");

CREATE INDEX IF NOT EXISTS "active_goals_status_updatedAt_idx"
    ON "active_goals"("status", "updatedAt");
