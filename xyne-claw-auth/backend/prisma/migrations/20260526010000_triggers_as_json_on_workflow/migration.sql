-- Add triggers JSON array directly on the workflow row.
-- Each entry: { id, type, channels: [{ channelId, spacesAutomationId }] }
ALTER TABLE "agent_chain_workflows"
    ADD COLUMN IF NOT EXISTS "triggers" JSONB NOT NULL DEFAULT '[]';
