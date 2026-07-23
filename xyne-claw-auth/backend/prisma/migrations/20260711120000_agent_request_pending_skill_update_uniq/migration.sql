-- R4 fix: enforce "one pending skill_update proposal per (skill, proposer)" at
-- the DATABASE level. The propose-update route deduped read-before-create
-- (findPendingSkillUpdate -> createSkillUpdate), which races under concurrency
-- and can persist duplicate pending requests + fire duplicate approval DMs.
-- This partial unique index makes the database the uniqueness boundary; the
-- route now catches the resulting P2002 and returns the same friendly 409.
--
-- Partial (WHERE) scope: pending skill_update rows ONLY, so it never constrains
-- clone / push_to_spaces / push_to_global requests, and once a request is
-- approved/rejected the proposer may propose again. Prisma's schema DSL cannot
-- express a partial unique index, so this lives only as a raw migration
-- (intentional; there is no matching @@unique in schema.prisma). IF NOT EXISTS
-- keeps re-apply safe.

-- Collapse any pre-existing duplicate pending rows first so the index can build:
-- keep the oldest per (skillId, requesterId), reject the rest.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "skillId", "requesterId"
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "agent_requests"
  WHERE "requestType" = 'skill_update' AND "status" = 'pending'
)
UPDATE "agent_requests" a
SET "status" = 'rejected',
    "reviewNote" = 'Superseded: duplicate pending proposal collapsed by uniqueness migration'
FROM ranked r
WHERE a."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_requests_pending_skill_update_uniq"
  ON "agent_requests" ("skillId", "requesterId")
  WHERE "requestType" = 'skill_update' AND "status" = 'pending';
