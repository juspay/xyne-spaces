-- AlterEnum
-- Adds the activity type used to surface Mobius release-update events in the
-- ticket Details ▸ Activity feed (written by the Mobius webhook + history backfill).
ALTER TYPE "public"."ActivityType" ADD VALUE 'MOBIUS_RELEASE_UPDATE';
