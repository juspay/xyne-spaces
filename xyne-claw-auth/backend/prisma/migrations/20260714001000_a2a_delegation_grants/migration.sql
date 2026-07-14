-- Agent-to-Agent (A2A) delegation grants.
--
-- Local dev DBs that already ran the earlier version of this migration need
-- the guarded ALTER TABLE statements below re-run to pick up the approval
-- columns. Re-running this file is idempotent: CREATE/INDEX use IF NOT EXISTS,
-- and the upgrade ALTERs use ADD COLUMN IF NOT EXISTS.
--
-- Manual/studio apply safe: this table may already exist in environments where
-- the schema change was applied manually during rollout. All DDL below is
-- guarded with IF NOT EXISTS and matches prisma/schema.prisma's
-- AgentDelegationGrant model exactly. The table is intentionally plain ids
-- rather than FK relations so deleting/renaming agents cannot accidentally
-- widen runtime delegation; the resolver fails closed against enabled agents.

CREATE TABLE IF NOT EXISTS "agent_delegation_grants" (
  "id"              TEXT NOT NULL,
  "callerAgentId"   TEXT NOT NULL,
  "calleeAgentId"   TEXT NOT NULL,
  "identityMode"    TEXT NOT NULL DEFAULT 'user',
  "enabled"         BOOLEAN NOT NULL DEFAULT true,
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "approvedByUserId" TEXT,
  "approvedAt"      TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_delegation_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_delegation_grants_callerAgentId_calleeAgentId_key"
  ON "agent_delegation_grants" ("callerAgentId", "calleeAgentId");

CREATE INDEX IF NOT EXISTS "agent_delegation_grants_callerAgentId_idx"
  ON "agent_delegation_grants" ("callerAgentId");

ALTER TABLE "agent_delegation_grants"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_delegation_grants_status_check'
  ) THEN
    ALTER TABLE "agent_delegation_grants"
      ADD CONSTRAINT "agent_delegation_grants_status_check"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "agent_delegation_grants_calleeAgentId_status_idx"
  ON "agent_delegation_grants" ("calleeAgentId", "status");
