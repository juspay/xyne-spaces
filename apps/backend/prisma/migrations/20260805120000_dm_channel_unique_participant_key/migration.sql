-- XYNE-55089: Make DM / GROUP_DM channel creation concurrency-safe.
--
-- `channels.name` already materializes the normalized participant set:
--   * self-DM   -> "<userId>"
--   * 1:1 DM    -> sorted "<userIdA>,<userIdB>"
--   * group DM  -> sorted "<id1>,<id2>,...,<idN>"
-- This partial unique index makes (workspaceId, name) the DB-enforced source of
-- truth for DM/GROUP_DM channels, closing the check-then-create race where two
-- concurrent "open DM" requests both insert a duplicate channel.
--
-- IMPORTANT (rollout): if any workspace already has duplicate DM/GROUP_DM
-- channels from past races, this CREATE UNIQUE INDEX will FAIL. Run the
-- de-duplication script FIRST and confirm zero duplicates:
--   npx tsx scripts/backfill/dedup-dm-channels.ts --dry-run   (audit)
--   npx tsx scripts/backfill/dedup-dm-channels.ts             (apply)
-- The query below returns the offending groups (should be empty pre-deploy):
--   SELECT "workspaceId", "name", COUNT(*) FROM "public"."channels"
--   WHERE "scopeType" IN ('DM','GROUP_DM')
--   GROUP BY "workspaceId", "name" HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "channels_workspaceId_name_dm_key"
  ON "public"."channels" ("workspaceId", "name")
  WHERE "scopeType" IN ('DM', 'GROUP_DM');
