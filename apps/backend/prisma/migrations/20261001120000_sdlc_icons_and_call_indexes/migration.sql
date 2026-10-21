-- AlterTable
-- A folder's chosen icon, an @xyne/icons name. Nullable: folders without one keep
-- showing the folder mark, so existing rows need nothing.
ALTER TABLE "public"."sdlc_folders" ADD COLUMN IF NOT EXISTS "icon" TEXT;

-- AlterTable
-- A track's chosen icon, an @xyne/icons name, shared by everyone in the hub.
-- Nullable: tracks without one keep showing the track mark.
ALTER TABLE "public"."sdlc_tracks" ADD COLUMN IF NOT EXISTS "icon" TEXT;

-- CreateIndex
-- A hub's and a track's Calls lists: ended calls newest first, paged by (endedAt, id),
-- and scheduled calls by start time, both within one channel. The existing call
-- indexes lead with status or time across every workspace, not the channel.
-- CONCURRENTLY: calls is written on every LiveKit webhook.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_channelId_status_endedAt_idx" ON "public"."calls"("channelId", "status", "endedAt" DESC);

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_channelId_status_startsAt_idx" ON "public"."calls"("channelId", "status", "startsAt");
