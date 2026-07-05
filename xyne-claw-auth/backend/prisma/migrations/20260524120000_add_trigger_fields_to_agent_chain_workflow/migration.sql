-- Add triggerConfig and spacesAutomationId to agent_chain_workflows
-- for bidirectional automation lifecycle between Claw Auth and Spaces

ALTER TABLE "agent_chain_workflows"
ADD COLUMN IF NOT EXISTS "triggerConfig" JSONB,
ADD COLUMN IF NOT EXISTS "spacesAutomationId" TEXT;
