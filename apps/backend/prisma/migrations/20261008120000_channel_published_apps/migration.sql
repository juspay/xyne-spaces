-- Artifact apps published to a channel, DM, group DM or desk: one row per app
-- per channel, replacing JSON string[] columns..

-- CreateTable
CREATE TABLE "public"."channel_published_apps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_published_apps_pkey" PRIMARY KEY ("id")
);

-- An app is published at most once per channel.
CREATE UNIQUE INDEX "channel_published_apps_channelId_appId_key"
    ON "public"."channel_published_apps"("channelId", "appId");

-- The read path: one channel's apps, in order.
CREATE INDEX "channel_published_apps_channelId_position_idx"
    ON "public"."channel_published_apps"("channelId", "position");

CREATE INDEX "channel_published_apps_workspaceId_idx"
    ON "public"."channel_published_apps"("workspaceId");

-- Backfill desks: every id in "deskAppIds" becomes a row, keeping its order
-- (position = array index). Rows that aren't a JSON array are skipped rather
-- than failing the migration. The id is derived from (channelId, appId), so a
-- re-run (or the follow-up drop migration repeating this copy) can't duplicate.
INSERT INTO "public"."channel_published_apps"
    ("id", "workspaceId", "channelId", "appId", "position", "publishedBy")
SELECT
    'cpa_' || md5(p."channelId" || ':' || a.app_id),
    p."workspaceId",
    p."channelId",
    a.app_id,
    (a.ord - 1)::INTEGER,
    COALESCE(p."ownerUserId", 'migration')
FROM "public"."email_channel_preferences" p
CROSS JOIN LATERAL jsonb_array_elements_text(p."deskAppIds"::jsonb) WITH ORDINALITY AS a(app_id, ord)
WHERE p."deskAppIds" IS NOT NULL
  AND p."deskAppIds" LIKE '[%'
  AND length(a.app_id) BETWEEN 1 AND 64
ON CONFLICT ("channelId", "appId") DO NOTHING;
