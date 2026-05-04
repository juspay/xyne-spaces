-- Add per-user chain config to user_agent_configs
ALTER TABLE "user_agent_configs" ADD COLUMN "chainConfig" JSONB;
