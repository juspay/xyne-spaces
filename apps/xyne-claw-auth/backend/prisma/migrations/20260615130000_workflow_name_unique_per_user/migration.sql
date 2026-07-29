-- Scope workflow names to their creator: enforce @@unique([createdByUserId, name])
-- on agent_chain_workflows so a single user can't own two same-named workflows
-- (the default "New Channel Workflow" name made dupes the common case). Different
-- users may still reuse a name — workflows are resolved by id and listed per user,
-- so there's no cross-user overlap.
--
-- Existing data almost certainly has duplicate (createdByUserId, name) pairs, which
-- would make the unique index fail. So FIRST de-duplicate: keep the oldest row's
-- name unchanged and suffix the rest with " (2)", " (3)", … by createdAt.

-- 1) Rename duplicates (rn>1) within each (createdByUserId, name) group.
WITH ranked AS (
  SELECT
    "id",
    "name",
    row_number() OVER (
      PARTITION BY "createdByUserId", "name"
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "agent_chain_workflows"
)
UPDATE "agent_chain_workflows" w
SET "name" = r."name" || ' (' || r.rn || ')'
FROM ranked r
WHERE w."id" = r."id"
  AND r.rn > 1;

-- 2) Drop the now-redundant standalone index (the composite unique covers
--    createdByUserId-prefixed lookups). IF EXISTS so it's safe if absent.
DROP INDEX IF EXISTS "agent_chain_workflows_createdByUserId_idx";

-- 3) Add the per-user unique constraint.
CREATE UNIQUE INDEX "agent_chain_workflows_createdByUserId_name_key"
  ON "agent_chain_workflows" ("createdByUserId", "name");
