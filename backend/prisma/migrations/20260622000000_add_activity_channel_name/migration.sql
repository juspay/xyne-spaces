-- Denormalized channel name on activities so they can show the channel to non-members (e.g. a shared canvas).
ALTER TABLE "public"."activities" ADD COLUMN "channelName" TEXT;
