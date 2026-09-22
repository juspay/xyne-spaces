-- agent_memory_files gains a tenant key.
--
-- The table was keyed (agentSlug, userId, name). That is unambiguous for
-- per-user files, since a user belongs to exactly one org, but shared files
-- (userId NULL) had no tenant at all — and agent slugs are only unique inside
-- an org (agents.@@unique([orgId, slug])), so two tenants with an agent named
-- "orchestrator" addressed one row. The app upserts shared files by
-- findFirst + update, so the second org's write would have replaced the first
-- org's content in place, with no history to recover it from.
--
-- Backfilled rather than defaulted: every existing row has a real owner to
-- inherit from.

ALTER TABLE "agent_memory_files" ADD COLUMN "orgId" TEXT;

-- Per-user files take their owner's org. userId has an ON DELETE CASCADE FK to
-- users, so every non-NULL userId resolves and users.orgId is NOT NULL.
UPDATE "agent_memory_files" f
   SET "orgId" = u."orgId"
  FROM "users" u
 WHERE f."userId" = u."id"
   AND f."orgId" IS NULL;

-- Shared files have no owner, so the org comes from the agent they name — but
-- only where that slug exists in exactly one org, which is the whole reason
-- this column is being added. Expected to match zero rows: the only writer of
-- shared files is the usage-pattern synthesizer, which has not shipped.
UPDATE "agent_memory_files" f
   SET "orgId" = a."orgId"
  FROM (SELECT "slug", MIN("orgId") AS "orgId"
          FROM "agents"
         GROUP BY "slug"
        HAVING COUNT(DISTINCT "orgId") = 1) a
 WHERE f."userId" IS NULL
   AND f."agentSlug" = a."slug"
   AND f."orgId" IS NULL;

-- Anything left is a shared file whose slug is ambiguous across orgs; there is
-- no safe answer, and guessing would hand one tenant another's document. Fail
-- the migration with something an operator can act on instead of letting the
-- NOT NULL below report a bare "column contains null values".
DO $$
DECLARE orphans TEXT;
BEGIN
  SELECT string_agg(DISTINCT "agentSlug", ', ')
    INTO orphans
    FROM "agent_memory_files"
   WHERE "orgId" IS NULL;

  IF orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'agent_memory_files: cannot resolve an org for shared files on agent slug(s): %. Assign "orgId" by hand (or delete the rows) and re-run.', orphans;
  END IF;
END $$;

ALTER TABLE "agent_memory_files" ALTER COLUMN "orgId" SET NOT NULL;

-- Re-key on the tenant. NB: Postgres still treats NULL userId rows as distinct,
-- so shared-file uniqueness stays enforced in the app's upsert; what changes is
-- that two orgs can now hold the same (agentSlug, name) without collision.
DROP INDEX "agent_memory_files_agentSlug_userId_name_key";
CREATE UNIQUE INDEX "agent_memory_files_orgId_agentSlug_userId_name_key"
  ON "agent_memory_files" ("orgId", "agentSlug", "userId", "name");
