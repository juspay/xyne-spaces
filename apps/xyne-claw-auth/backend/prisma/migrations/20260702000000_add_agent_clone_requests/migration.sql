-- Agent cloning: extend agent_requests to support requestType = "clone".
-- Additive only — no data backfill, no column drops. Existing
-- push_to_spaces / push_to_global rows are unaffected.

-- Track the agent created when a clone request is approved. Nullable so
-- non-clone rows and still-pending clone rows leave it NULL. Enables an
-- idempotent approve path (replay returns the same clone) and a frontend
-- deep-link to the newly created agent.
ALTER TABLE "agent_requests" ADD COLUMN "resultAgentId" TEXT;

-- Owner-inbox lookups filter clone requests by the source agent's owner,
-- which joins on agentId. Index it so the inbox query stays cheap as the
-- request table grows.
CREATE INDEX "agent_requests_agentId_idx" ON "agent_requests"("agentId");
