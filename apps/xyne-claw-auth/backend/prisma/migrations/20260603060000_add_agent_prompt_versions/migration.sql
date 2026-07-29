-- Agent prompt versioning.
-- `agents.systemPrompt` stays the denormalized copy of the ACTIVE version, so
-- every runtime read path is unchanged. History/rollback/attribution layer
-- around it via agent_prompt_versions + the two active-pointer columns.

-- 1) Append-only version history table.
CREATE TABLE "agent_prompt_versions" (
  "id"              TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "version"         INTEGER NOT NULL,
  "systemPrompt"    TEXT NOT NULL,
  "note"            TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_prompt_versions_agentId_version_key"
  ON "agent_prompt_versions" ("agentId", "version");
CREATE INDEX "agent_prompt_versions_agentId_createdAt_idx"
  ON "agent_prompt_versions" ("agentId", "createdAt");

ALTER TABLE "agent_prompt_versions"
  ADD CONSTRAINT "agent_prompt_versions_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Active-pointer columns on agents.
ALTER TABLE "agents" ADD COLUMN "activePromptVersionId" TEXT;
ALTER TABLE "agents" ADD COLUMN "activePromptVersion"   INTEGER;

-- 3) Per-run attribution.
ALTER TABLE "agent_runs" ADD COLUMN "promptVersion" INTEGER;

-- 4) Backfill: seed v1 for every existing agent from its current systemPrompt,
--    then point each agent at that row. Idempotent-safe via the unique index
--    (re-running would conflict, but migrations run once).
INSERT INTO "agent_prompt_versions" ("id", "agentId", "version", "systemPrompt", "note", "createdByUserId", "createdAt")
SELECT
  gen_random_uuid()::text,
  a."id",
  1,
  a."systemPrompt",
  'Initial version (backfilled)',
  a."ownerUserId",
  NOW()
FROM "agents" a;

UPDATE "agents" a
SET "activePromptVersion" = 1,
    "activePromptVersionId" = v."id"
FROM "agent_prompt_versions" v
WHERE v."agentId" = a."id" AND v."version" = 1;
