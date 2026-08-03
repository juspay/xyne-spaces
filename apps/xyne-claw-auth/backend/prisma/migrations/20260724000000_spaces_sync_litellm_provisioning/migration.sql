-- Spaces sync + LiteLLM org-level provisioning (XYNE-17334).
--
-- Consolidates the former spaces_sync_litellm_provisioning and
-- org_provider_credentials migrations into a single migration.
--
-- Adds:
--   1. Spaces org awareness on connected_surfaces.
--   2. Hidden system-managed user provider credentials (managedBy + PK widening).
--   3. Org-level external provider mappings for LiteLLM teams.
--   4. Org-level provider credentials (the org-level LiteLLM key).
--   5. COMMUNITY_MEMBER org role.

-- 1. Track upstream surface org IDs on connected_surfaces.
-- For Spaces:
--   surfaceTenantId = public.workspaces.id
--   surfaceOrgId    = public.workspaces.orgId
ALTER TABLE "connected_surfaces"
  ADD COLUMN IF NOT EXISTS "surfaceOrgId" TEXT;

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceTenantId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceTenantId");

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceOrgId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceOrgId");

-- 2. Split user-visible credentials from hidden system-managed credentials.
-- Existing rows are user-managed by default.
ALTER TABLE "user_provider_credentials"
  ADD COLUMN IF NOT EXISTS "managedBy" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "user_provider_credentials"
  DROP CONSTRAINT IF EXISTS "user_provider_credentials_pkey";

ALTER TABLE "user_provider_credentials"
  ADD CONSTRAINT "user_provider_credentials_pkey" PRIMARY KEY ("userId", "provider", "managedBy");

-- 3. Org-level external provider mappings. LiteLLM uses one team per Claw org.
CREATE TABLE IF NOT EXISTS "org_provider_integrations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalAlias" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_provider_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_provider_integrations_orgId_provider_key"
  ON "org_provider_integrations"("orgId", "provider");

CREATE INDEX IF NOT EXISTS "org_provider_integrations_provider_externalId_idx"
  ON "org_provider_integrations"("provider", "externalId");

ALTER TABLE "org_provider_integrations"
  ADD CONSTRAINT "org_provider_integrations_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Org-level provider credentials (e.g. the org-level LiteLLM key provisioned
--    during team creation). Mirrors user_provider_credentials but keyed on orgId,
--    without the per-key model/baseUrl/authType columns — those are LiteLLM
--    constants resolved at read time, not per-key data.
--
--    Used ONLY at call sites that run under the ORG's identity (no meaningful
--    user context). It is NOT an automatic fallback when a user key is missing.
CREATE TABLE IF NOT EXISTS "org_provider_credentials" (
    "id"           TEXT         NOT NULL,
    "orgId"        TEXT         NOT NULL,
    "provider"     TEXT         NOT NULL,
    "encryptedKey" TEXT         NOT NULL,
    "iv"           TEXT         NOT NULL,
    "authTag"      TEXT         NOT NULL,
    "metadata"     JSONB        NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_provider_credentials_orgId_provider_key"
    ON "org_provider_credentials"("orgId", "provider");

ALTER TABLE "org_provider_credentials"
    ADD CONSTRAINT "org_provider_credentials_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Add COMMUNITY_MEMBER to the OrgRole enum (org membership roles).
--    Additive ALTER TYPE ... ADD VALUE; cannot run inside a transaction block,
--    Prisma migrate handles additive enum values outside the txn wrapper.
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'COMMUNITY_MEMBER';
