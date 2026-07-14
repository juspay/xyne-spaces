-- Phase 4 Slice 0: Surface foundation.
-- Additive surface catalog/tables, seed Spaces + CLI, fold existing
-- surface_tenant_links into connected_surfaces. Does not drop legacy links.

DO $$
BEGIN
  CREATE TYPE "SurfaceIdentityMode" AS ENUM ('USER_ID', 'ACCESS_TOKEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SurfaceStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "surfaces" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "identityMode" "SurfaceIdentityMode" NOT NULL,
    "supportsUserResolution" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surfaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "connected_surfaces" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceTenantId" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "config" JSONB,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_surfaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_surface_identities" (
    "id" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceWorkspaceId" TEXT NOT NULL DEFAULT '',
    "surfaceUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_surface_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "surface_agents" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceTenantId" TEXT NOT NULL DEFAULT '',
    "surfaceChannelId" TEXT,
    "signingSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "surface_access_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "client" TEXT,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "surfaces_key_key" ON "surfaces"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "connected_surfaces_orgId_surfaceId_surfaceTenantId_key" ON "connected_surfaces"("orgId", "surfaceId", "surfaceTenantId");
CREATE INDEX IF NOT EXISTS "connected_surfaces_orgId_idx" ON "connected_surfaces"("orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "user_surface_identities_surfaceId_surfaceWorkspaceId_surfaceUserId_key" ON "user_surface_identities"("surfaceId", "surfaceWorkspaceId", "surfaceUserId");
CREATE INDEX IF NOT EXISTS "user_surface_identities_orgId_idx" ON "user_surface_identities"("orgId");
CREATE INDEX IF NOT EXISTS "user_surface_identities_userId_idx" ON "user_surface_identities"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "surface_agents_agentId_surfaceId_surfaceTenantId_key" ON "surface_agents"("agentId", "surfaceId", "surfaceTenantId");
CREATE INDEX IF NOT EXISTS "surface_agents_surfaceId_idx" ON "surface_agents"("surfaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "surface_access_tokens_tokenHash_key" ON "surface_access_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "surface_access_tokens_userId_surfaceId_idx" ON "surface_access_tokens"("userId", "surfaceId");
CREATE INDEX IF NOT EXISTS "surface_access_tokens_orgId_idx" ON "surface_access_tokens"("orgId");

DO $$
BEGIN
  ALTER TABLE "connected_surfaces" ADD CONSTRAINT "connected_surfaces_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "user_surface_identities" ADD CONSTRAINT "user_surface_identities_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "user_surface_identities" ADD CONSTRAINT "user_surface_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "surface_agents" ADD CONSTRAINT "surface_agents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "surface_agents" ADD CONSTRAINT "surface_agents_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "surface_access_tokens" ADD CONSTRAINT "surface_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "surface_access_tokens" ADD CONSTRAINT "surface_access_tokens_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "surfaces" ("id", "key", "identityMode", "supportsUserResolution", "status", "createdAt", "updatedAt")
VALUES
  ('spaces', 'spaces', 'USER_ID', true, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cli', 'cli', 'ACCESS_TOKEN', false, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "connected_surfaces" ("id", "orgId", "surfaceId", "surfaceTenantId", "status", "createdAt", "updatedAt")
SELECT
  "surface_tenant_links"."id",
  "surface_tenant_links"."orgId",
  "surfaces"."id",
  COALESCE("surface_tenant_links"."surfaceTenantId", ''),
  'ACTIVE'::"SurfaceStatus",
  "surface_tenant_links"."createdAt",
  CURRENT_TIMESTAMP
FROM "surface_tenant_links"
JOIN "surfaces" ON "surfaces"."key" = 'spaces'
WHERE "surface_tenant_links"."surfaceType" = 'spaces'
ON CONFLICT DO NOTHING;

-- (2026-07-14) CONCURRENTLY removed: prisma migrate runs this file inside a
-- transaction where CONCURRENTLY is illegal; prod applies SQL manually and
-- can use the concurrent variant there.
DROP INDEX IF EXISTS "users_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_orgId_key" ON "users"("email", "orgId");
