-- AlterTable
ALTER TABLE "channels" ADD COLUMN "participantCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill participantCount with actual counts from channel_participants
UPDATE "channels" 
SET "participantCount" = (
  SELECT COUNT(*) 
  FROM "channel_participants" 
  WHERE "channel_participants"."channelId" = "channels"."id"
);
