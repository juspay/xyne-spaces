-- Hub / Laya selection decision log (shadow + fast gate telemetry)
CREATE TABLE IF NOT EXISTS "agent_tool_decisions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "surface" TEXT NOT NULL DEFAULT 'hub',
    "intent" TEXT NOT NULL,
    "emptyHubs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "shortlistIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "closedPick" JSONB NOT NULL DEFAULT '{}',
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "fallback" TEXT NOT NULL DEFAULT 'none',
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "packVersion" TEXT NOT NULL DEFAULT 'authoring-pack-v2',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_tool_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_tool_decisions_orgId_createdAt_idx"
  ON "agent_tool_decisions"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_tool_decisions_mode_createdAt_idx"
  ON "agent_tool_decisions"("mode", "createdAt");
