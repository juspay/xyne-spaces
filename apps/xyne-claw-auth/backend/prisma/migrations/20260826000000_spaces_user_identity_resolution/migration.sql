-- Spaces user identity resolution (XYNE-17334 identity slice).
--
-- Problem: Spaces issues a DIFFERENT public.users.id per workspace membership,
-- so the same person appears in Claw as N different users and cross-workspace
-- calls fail. Fix: one canonical Claw user per (org, person) with the
-- workspace-scoped Spaces ids stored as resolvable surface identities.
--
-- This migration is additive only (one column, two indexes, an enum value) —
-- safe to run before the code deploy and against production data.

-- 1. Generic per-surface person key on user_surface_identities.
--    Person-level reuse across workspaces is EMAIL-PRIMARY within an org at
--    runtime (the (email, orgId) unique index on users already exists from
--    org phase-1 migrations). That invariant can break when two DISTINCT
--    people share one email in an org, so identities additionaly carry the
--    source system's guaranteed person key (Spaces = public.org_members.id)
--    -- a nullable, non-unique, surface-generic column that lets first-contact
--    resolution hard-REFUSE email-collision merges instead of silently
--    collapsing two humans into one Claw user. Same member can legitimately
--    span multiple rows (one per workspace), so this is a plain lookup index.
ALTER TABLE "user_surface_identities"
  ADD COLUMN IF NOT EXISTS "surfaceMemberId" TEXT;

CREATE INDEX IF NOT EXISTS "user_surface_identities_surfaceId_orgId_surfaceMemberId_idx"
  ON "user_surface_identities"("surfaceId", "orgId", "surfaceMemberId");

-- 2. Spaces org awareness on connected_surfaces.
--    For Spaces:
--      surfaceTenantId = public.workspaces.id
--      surfaceOrgId    = public.workspaces.orgId
--    An org-level mapping is a row with surfaceTenantId = '' and
--    surfaceOrgId = <spacesOrgId>; a workspace mapping carries both.
ALTER TABLE "connected_surfaces"
  ADD COLUMN IF NOT EXISTS "surfaceOrgId" TEXT;

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceTenantId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceTenantId");

CREATE INDEX IF NOT EXISTS "connected_surfaces_surfaceId_surfaceOrgId_idx"
  ON "connected_surfaces"("surfaceId", "surfaceOrgId");

-- 3. Add COMMUNITY_MEMBER to the OrgRole enum (mirrors Spaces org_roles).
--    Additive ALTER TYPE ... ADD VALUE; cannot run inside a transaction block,
--    Prisma migrate handles additive enum values outside the txn wrapper.
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'COMMUNITY_MEMBER';
