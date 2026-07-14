-- Phase 1 follow-up: enforce that every user belongs to an org.
--
-- PREREQUISITE — do NOT apply until BOTH are true:
--   1. scripts/backfill-default-org.ts has run and reports 0 users with orgId IS NULL.
--   2. The image that creates users WITH orgId at insert time is DEPLOYED
--      (users-jit.ts + routes/users.ts set orgId; schema.prisma marks it required).
-- Applying this before (2) is deployed breaks new-user creation on the old
-- image (org-less INSERT → NOT NULL violation). Reverse with:
--   ALTER TABLE "users" ALTER COLUMN "orgId" DROP NOT NULL;

ALTER TABLE "users" ALTER COLUMN "orgId" SET NOT NULL;
