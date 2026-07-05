-- AgentImprovementCandidate: output of the FailureCurator. One row per
-- distinct (agent, bucket, rootCause) finding, with evidence sessionIds.
-- Status flows pending → applied | dismissed. Hourly worker upserts here.

CREATE TABLE "agent_improvement_candidates" (
    "id"          TEXT NOT NULL,
    "agentSlug"   TEXT NOT NULL,
    "bucket"      TEXT NOT NULL,
    "rootCause"   TEXT NOT NULL,
    "finding"     TEXT NOT NULL,
    "evidence"    JSONB NOT NULL,
    "proposedFix" JSONB NOT NULL,
    "confidence"  TEXT NOT NULL DEFAULT 'medium',
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "metadata"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_improvement_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_improvement_candidates_agentSlug_status_updatedAt_idx"
    ON "agent_improvement_candidates" ("agentSlug", "status", "updatedAt");
CREATE INDEX "agent_improvement_candidates_status_createdAt_idx"
    ON "agent_improvement_candidates" ("status", "createdAt");

-- AgentCuratorState: per-agent watermark so the hourly worker only scans
-- runs completed AFTER the last successful curator pass. Without this we
-- re-process the same negative sessions on every tick and create duplicate
-- candidates.

CREATE TABLE "agent_curator_state" (
    "agentSlug"        TEXT NOT NULL,
    "lastProcessedAt"  TIMESTAMP(3) NOT NULL,
    "lastRunAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invocationCount"  INTEGER NOT NULL DEFAULT 0,
    "candidateCount"   INTEGER NOT NULL DEFAULT 0,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_curator_state_pkey" PRIMARY KEY ("agentSlug")
);
