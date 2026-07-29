-- Agent-level provider credentials — mirror of user_provider_credentials but
-- scoped to an agent. Used when a user runs an agent without their own
-- provider configured: claw-auth falls back to the agent's shared keys
-- (e.g., a team's Codex subscription wired to the Doctor agent).
--
-- Resolution precedence at session dispatch:
--   1. userAgentConfig.provider + userProviderCredentials  (personal)
--   2. agent.config.provider + agentProviderCredentials    (shared)  ← THIS
--   3. "spaces" / LiteLLM platform default                  (fallback)
--
-- Permission model enforced in routes/agents.ts:
--   - Write (POST/PATCH/DELETE) requires AGENT_OWNER or admin.
--   - Read (GET status — no decrypted key) requires OWNER / CONTRIBUTOR / admin.
--   - The decrypted key is NEVER returned through any API surface; it is only
--     ever decrypted in-process at webhook-dispatch time and forwarded to claw.
CREATE TABLE IF NOT EXISTS "agent_provider_credentials" (
    "agentId"         TEXT     NOT NULL,
    "provider"        TEXT     NOT NULL,
    "encryptedKey"    TEXT,
    "iv"              TEXT,
    "authTag"         TEXT,
    "model"           TEXT,
    "baseUrl"         TEXT,
    "authType"        TEXT,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_provider_credentials_pkey" PRIMARY KEY ("agentId", "provider")
);

-- FK to agents — cascade delete so removing an agent cleans up its keys.
ALTER TABLE "agent_provider_credentials"
    ADD CONSTRAINT "agent_provider_credentials_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- Soft FK to users for audit (who uploaded the key). We don't cascade-delete
-- because we want the credential to outlive the uploader's account row;
-- on user delete the credential just shows createdByUserId=NULL.
CREATE INDEX IF NOT EXISTS "agent_provider_credentials_createdByUserId_idx"
    ON "agent_provider_credentials" ("createdByUserId");
