ALTER TABLE "user_surface_identities"
  ADD COLUMN IF NOT EXISTS "surfaceMemberId" TEXT;

CREATE INDEX IF NOT EXISTS "user_surface_identities_surfaceId_orgId_surfaceMemberId_idx"
  ON "user_surface_identities"("surfaceId", "orgId", "surfaceMemberId");

ALTER TABLE "connected_surfaces"
  ADD COLUMN IF NOT EXISTS "surfaceOrgId" TEXT;

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceTenantId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceTenantId");

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceOrgId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceOrgId");

ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'COMMUNITY_MEMBER';
