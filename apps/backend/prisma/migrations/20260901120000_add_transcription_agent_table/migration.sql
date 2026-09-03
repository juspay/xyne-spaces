---- Prisma model: TranscriptionAgent
CREATE TABLE "non_zero"."transcription_agent" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcription_agent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transcription_agent_agentName_idx" ON "non_zero"."transcription_agent"("agentName");

-- At most one ACTIVE row per role. Inactive rows keep whatever role they historically
-- held without colliding with the current holder — Postgres never treats two NULLs as
-- equal, so this needs no WHERE role IS NOT NULL; the WHERE status='active' scoping is
-- what does the real work. Prisma's schema DSL has no partial-index syntax, so this
-- index is hand-added here rather than expressed via @@unique in schema.prisma.
CREATE UNIQUE INDEX "transcription_agent_active_role_key"
ON "non_zero"."transcription_agent"("role") WHERE "status" = 'active';
