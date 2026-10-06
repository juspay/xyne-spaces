ALTER TABLE "user_provider_credentials"
  ADD COLUMN IF NOT EXISTS "managedBy" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "user_provider_credentials"
  DROP CONSTRAINT IF EXISTS "user_provider_credentials_pkey";

ALTER TABLE "user_provider_credentials"
  ADD CONSTRAINT "user_provider_credentials_pkey" PRIMARY KEY ("userId", "provider", "managedBy");

CREATE TABLE IF NOT EXISTS "org_provider_integrations" (
    "id"            TEXT         NOT NULL,
    "orgId"         TEXT         NOT NULL,
    "provider"      TEXT         NOT NULL,
    "externalId"    TEXT         NOT NULL,
    "externalAlias" TEXT,
    "status"        TEXT         NOT NULL DEFAULT 'ACTIVE',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_provider_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_provider_integrations_orgId_provider_key"
  ON "org_provider_integrations"("orgId", "provider");

CREATE INDEX IF NOT EXISTS "org_provider_integrations_provider_externalId_idx"
  ON "org_provider_integrations"("provider", "externalId");

ALTER TABLE "org_provider_integrations"
  ADD CONSTRAINT "org_provider_integrations_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
