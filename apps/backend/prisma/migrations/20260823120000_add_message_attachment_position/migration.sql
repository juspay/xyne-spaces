-- Add an explicit display-order column for message attachments.
-- Ordering was previously reconstructed from `createdAt` (with `id` as a tiebreak),
-- which collides when multiple attachments share a timestamp (e.g. forward-clones
-- inserted with the same `now`), producing a different order than the source message.
-- AlterTable
ALTER TABLE "public"."message_attachments" ADD COLUMN "position" INTEGER;

-- No backfill: readers sort on (position, createdAt, id), so legacy rows with a null
-- position keep the exact order they had before this column existed.

-- Support ordered reads per entity.
CREATE INDEX "message_attachments_entityId_position_idx"
  ON "public"."message_attachments" ("entityId", "position");
