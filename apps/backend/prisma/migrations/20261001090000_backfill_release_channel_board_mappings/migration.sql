-- Data fix: link each release repo's main release board to its release channel.
--
-- Since XYNE-62786 the New Release modal lists repos from the channel's linked
-- boards (channel_board_mappings) instead of every board in the channel's
-- project. Main release boards configured before that change were never linked,
-- so release channels showed only some of their repos and services.
--
-- Source of truth: applications.(channelId, mainReleaseBoardId), written by
-- Release Manager on save. Idempotent (NOT EXISTS + ON CONFLICT), additive only,
-- and limited to same-workspace, non-archived DEFAULT channels — the same rules
-- ChannelBoardMappingsACL enforces. New rows are never the channel default, so
-- an existing default board is left untouched.
INSERT INTO "public"."channel_board_mappings"
    ("id", "channelId", "boardId", "workspaceId", "isDefault", "createdBy", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    pairs."channelId",
    pairs."boardId",
    b."workspaceId",
    false,
    b."createdBy",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT a."channelId", a."mainReleaseBoardId" AS "boardId"
    FROM "public"."applications" a
    WHERE a."channelId" IS NOT NULL
      AND a."mainReleaseBoardId" IS NOT NULL
) pairs
JOIN "public"."boards" b ON b."id" = pairs."boardId"
JOIN "public"."channels" c ON c."id" = pairs."channelId"
WHERE b."boardType" = 'RELEASE'
  AND c."scopeType" = 'DEFAULT'
  AND c."isArchived" = false
  AND c."workspaceId" = b."workspaceId"
  AND NOT EXISTS (
      SELECT 1
      FROM "public"."channel_board_mappings" m
      WHERE m."channelId" = pairs."channelId"
        AND m."boardId" = pairs."boardId"
  )
ON CONFLICT ("channelId", "boardId") DO NOTHING;
