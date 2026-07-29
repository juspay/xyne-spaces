-- Shared provider credentials (2026-07-14).
-- One org-level named credential row (e.g. "Team Codex") bound to selected
-- agents via agent_provider_credentials.sharedCredentialId. Fixes the OAuth
-- cross-invalidation problem: per-agent token COPIES of one ChatGPT account
-- invalidate each other on every re-auth; a binding shares ONE stored session.

-- CreateTable
CREATE TABLE "shared_provider_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "reasoningEffort" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_provider_credentials_orgId_provider_name_key"
  ON "shared_provider_credentials"("orgId", "provider", "name");
CREATE INDEX "shared_provider_credentials_orgId_idx"
  ON "shared_provider_credentials"("orgId");

-- AlterTable: binding reference on agent creds
ALTER TABLE "agent_provider_credentials" ADD COLUMN "sharedCredentialId" TEXT;

CREATE INDEX "agent_provider_credentials_sharedCredentialId_idx"
  ON "agent_provider_credentials"("sharedCredentialId");

ALTER TABLE "agent_provider_credentials"
  ADD CONSTRAINT "agent_provider_credentials_sharedCredentialId_fkey"
  FOREIGN KEY ("sharedCredentialId") REFERENCES "shared_provider_credentials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit event values
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'PROVIDER_CREDENTIAL_PROMOTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'PROVIDER_CREDENTIAL_BOUND';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'PROVIDER_CREDENTIAL_UNBOUND';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'PROVIDER_CREDENTIAL_ADOPTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'PROVIDER_CREDENTIAL_DELETED';
