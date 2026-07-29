-- Consent-to-use-creator-credentials for triggered chain-workflow runs.
-- When non-null, triggered runs of this workflow resolve credentials as this
-- user (the consenting workflow owner) instead of the agent's app identity.
ALTER TABLE "agent_chain_workflows" ADD COLUMN "credentialUserId" TEXT;
