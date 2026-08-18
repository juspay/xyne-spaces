-- Stable Spaces person-in-org identity for Claw users.
--
-- Spaces `public.users.id` is a workspace membership id. A single person in
-- multiple workspaces therefore has multiple user ids but one
-- `public.org_members.memberId`. Keep Claw's existing User.id unchanged and
-- store the org-member id as an alternate canonical identity so existing Claw
-- foreign keys and Spaces session lookups remain valid during migration.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "spacesOrgMemberId" TEXT;

-- PostgreSQL unique indexes allow multiple NULL values, so legacy users remain
-- valid until their next trusted Spaces sync stamps the external identity.
CREATE UNIQUE INDEX IF NOT EXISTS "users_orgId_spacesOrgMemberId_key"
  ON "users"("orgId", "spacesOrgMemberId");
