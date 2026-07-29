-- Backing single-node workflow marker for agent-page triggers.
-- When set, the workflow is the auto-managed trigger holder for that agent and
-- is hidden from the Workflows list. Unique: one backing workflow per agent.
ALTER TABLE "agent_chain_workflows" ADD COLUMN "agentTriggerSlug" TEXT;
CREATE UNIQUE INDEX "agent_chain_workflows_agentTriggerSlug_key" ON "agent_chain_workflows"("agentTriggerSlug");
