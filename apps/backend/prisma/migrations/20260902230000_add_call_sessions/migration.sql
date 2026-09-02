-- CreateTable: append-only per-activation session rows for a Call.
-- Call.startedAt/endedAt becomes a projection of these rows (MIN start .. MAX end),
-- so a status-transition write (e.g. a rejoin) can no longer corrupt call duration.
CREATE TABLE "public"."call_sessions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_callId_idx" ON "public"."call_sessions"("callId");

-- CreateIndex: fast open-session lookup (endedAt IS NULL)
CREATE INDEX "call_sessions_callId_endedAt_idx" ON "public"."call_sessions"("callId", "endedAt");

-- NOTE: no DB-level FK — the repo uses Prisma relationMode="prisma"
-- (app-enforced relations). The call_sessions_callId_idx above covers lookups.

-- Backfill: one session per existing call mirroring its current startedAt/endedAt,
-- so historical calls keep a correct (uncorrupted-going-forward) envelope. Idempotent:
-- skips any call that already has a session row.
INSERT INTO "public"."call_sessions" ("id", "callId", "workspaceId", "startedAt", "endedAt", "createdAt")
SELECT gen_random_uuid()::text, c."id", c."workspaceId", c."startedAt", c."endedAt", CURRENT_TIMESTAMP
FROM "public"."calls" c
WHERE c."startedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "public"."call_sessions" s WHERE s."callId" = c."id"
  );
