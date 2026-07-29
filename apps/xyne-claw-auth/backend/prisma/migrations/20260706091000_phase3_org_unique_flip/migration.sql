-- Phase 3 Slice B: flip slugs/names from global uniqueness to org-scoped
-- uniqueness, and make phase-2 orgId columns required.
--
-- Manual-apply safe: guarded SET NOT NULL checks, IF EXISTS/IF NOT EXISTS
-- index operations, and no changes to credential tables.

DO $$
DECLARE
  table_name TEXT;
  null_count BIGINT;
  is_not_null BOOLEAN;
  backfill_hint TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agents',
    'skills',
    'subagent_definitions',
    'user_agent_configs',
    'agent_runs',
    'chat_messages',
    'agent_requests',
    'scheduled_jobs',
    'pending_memory_reviews',
    'pending_batch_reviews',
    'memory_recall_hits',
    'active_goals',
    'agent_improvement_candidates',
    'agent_curator_state',
    'eval_generations'
  ]
  LOOP
    SELECT a.attnotnull INTO is_not_null
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = table_name
      AND a.attname = 'orgId'
      AND NOT a.attisdropped;

    IF is_not_null IS TRUE THEN
      RAISE NOTICE 'Skipping %.orgId SET NOT NULL: already NOT NULL', table_name;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I WHERE "orgId" IS NULL', table_name)
    INTO null_count;

    IF null_count > 0 THEN
      backfill_hint := CASE
        WHEN table_name IN ('agents', 'skills', 'subagent_definitions') THEN 'scripts/backfill-phase2-agents.ts'
        ELSE 'scripts/backfill-phase2-child-orgid.ts'
      END;
      RAISE EXCEPTION 'Cannot set %.orgId NOT NULL: % rows still have NULL orgId. Run %, then rerun this migration.', table_name, null_count, backfill_hint;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN "orgId" SET NOT NULL', table_name);
  END LOOP;
END $$;

-- Swap each global-unique key to its org-scoped composite. The old `*_key`
-- may be backed by EITHER a plain unique index OR a unique CONSTRAINT depending
-- on how the original migration created it (varies by env / Prisma version) —
-- `DROP INDEX` fails on a constraint-backed one (SQLSTATE 2BP01). So drop the
-- constraint first (removes its backing index), then drop any plain index. Both
-- guarded, so whichever form exists is handled and the other is a no-op.

CREATE UNIQUE INDEX IF NOT EXISTS "agents_orgId_slug_key" ON "agents"("orgId", "slug");
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_slug_key";
DROP INDEX IF EXISTS "agents_slug_key";

CREATE UNIQUE INDEX IF NOT EXISTS "skills_orgId_slug_key" ON "skills"("orgId", "slug");
ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_slug_key";
DROP INDEX IF EXISTS "skills_slug_key";

CREATE UNIQUE INDEX IF NOT EXISTS "subagent_definitions_orgId_name_key" ON "subagent_definitions"("orgId", "name");
ALTER TABLE "subagent_definitions" DROP CONSTRAINT IF EXISTS "subagent_definitions_name_key";
DROP INDEX IF EXISTS "subagent_definitions_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_configs_userId_orgId_agentSlug_key" ON "user_agent_configs"("userId", "orgId", "agentSlug");
ALTER TABLE "user_agent_configs" DROP CONSTRAINT IF EXISTS "user_agent_configs_userId_agentSlug_key";
DROP INDEX IF EXISTS "user_agent_configs_userId_agentSlug_key";
