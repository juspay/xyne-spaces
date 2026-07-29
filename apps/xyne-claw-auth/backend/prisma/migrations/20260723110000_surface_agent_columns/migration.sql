-- Prisma model: SurfaceAgentInstall (mapped to table "surface_agent_installs").
-- Phase-6 promotion: fields the core queries move from SurfaceAgent.config
-- JSON into real columns; the per-tenant installs map becomes a table.
-- Additive + backfill; config keys are left in place (stripped by a later
-- cleanup migration once the code has soaked).

ALTER TABLE "surface_agents" ADD COLUMN "externalAppId" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "clientId" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "encryptedClientSecret" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "commandName" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "status" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "manifestHash" TEXT;
ALTER TABLE "surface_agents" ADD COLUMN "manifestSyncedAt" TIMESTAMP(3);

CREATE TABLE "surface_agent_installs" (
  "id" TEXT NOT NULL,
  "surfaceAgentId" TEXT NOT NULL,
  "surfaceTenantId" TEXT NOT NULL,
  "encryptedBotToken" TEXT NOT NULL,
  "tenantName" TEXT,
  "botUserId" TEXT,
  "installedByUserId" TEXT,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "surface_agent_installs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "surface_agent_installs_surfaceAgentId_fkey" FOREIGN KEY ("surfaceAgentId")
    REFERENCES "surface_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "surface_agent_installs_surfaceAgentId_surfaceTenantId_key"
  ON "surface_agent_installs"("surfaceAgentId", "surfaceTenantId");

-- Backfill promoted columns from the JSON blob.
UPDATE "surface_agents" SET
  "externalAppId"    = NULLIF(config->>'appId', ''),
  "clientId"         = NULLIF(config->>'clientId', ''),
  "encryptedClientSecret" = NULLIF(config->>'clientSecret', ''),
  "commandName"      = NULLIF(config->>'commandName', ''),
  "status"           = NULLIF(config->>'status', ''),
  "manifestHash"     = NULLIF(config->>'manifestHash', ''),
  "manifestSyncedAt" = CASE WHEN config ? 'manifestSyncedAt'
                            THEN (config->>'manifestSyncedAt')::timestamptz
                            ELSE NULL END
WHERE config IS NOT NULL;

-- Backfill installs from config.installs (a { [teamId]: {...} } map).
INSERT INTO "surface_agent_installs"
  ("id", "surfaceAgentId", "surfaceTenantId", "encryptedBotToken", "tenantName", "botUserId", "installedByUserId", "installedAt")
SELECT
  gen_random_uuid()::text,
  sa."id",
  install.key,
  install.value->>'encryptedBotToken',
  install.value->>'teamName',
  install.value->>'botUserId',
  install.value->>'installedByUserId',
  COALESCE((install.value->>'installedAt')::timestamptz, CURRENT_TIMESTAMP)
FROM "surface_agents" sa,
     jsonb_each(sa."config"->'installs') AS install
WHERE sa."config" ? 'installs'
  AND install.value->>'encryptedBotToken' IS NOT NULL
ON CONFLICT ("surfaceAgentId", "surfaceTenantId") DO NOTHING;

-- Unique AFTER backfill (fails loudly if two registrations claim one app id —
-- that is a real conflict a human must resolve, not paper over).
CREATE UNIQUE INDEX "surface_agents_surfaceId_externalAppId_key"
  ON "surface_agents"("surfaceId", "externalAppId");
