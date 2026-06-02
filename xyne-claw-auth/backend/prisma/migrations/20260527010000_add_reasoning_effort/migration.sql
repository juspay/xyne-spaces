-- Add reasoningEffort column to user-level and agent-level provider credentials.
--
-- Values: "low" | "medium" | "high". Only meaningful for reasoning-capable
-- models (codex gpt-5.x etc). Null means "use the service default" (medium,
-- pinned in xyne-claw/src/agent.ts effectiveThinking).
--
-- User-selectable in two UI places: SettingsPageV3 (personal credentials)
-- and AgentDetailPageV3 (agent-level fallback credentials).

ALTER TABLE "user_provider_credentials"
    ADD COLUMN IF NOT EXISTS "reasoningEffort" TEXT;

ALTER TABLE "agent_provider_credentials"
    ADD COLUMN IF NOT EXISTS "reasoningEffort" TEXT;
