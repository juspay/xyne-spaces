-- Add an explicit display-order column for message attachments.
-- Ordering was previously reconstructed from `createdAt` (with `id` as a tiebreak),
-- which collides when multiple attachments share a timestamp (e.g. forward-clones
-- inserted with the same `now`), producing a different order than the source message.
-- AlterTable
ALTER TABLE "public"."message_attachments" ADD COLUMN "position" INTEGER;

-- Backfill existing rows: freeze the currently displayed order (createdAt asc, id asc)
-- as an explicit per-message position so ordering stays stable going forward.
WITH ordered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "entityId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) - 1 AS rn
  FROM "public"."message_attachments"
)
UPDATE "public"."message_attachments" m
SET "position" = o.rn
FROM ordered o
WHERE m."id" = o."id";

-- Support ordered reads per entity.
CREATE INDEX "message_attachments_entityId_position_idx"
  ON "public"."message_attachments" ("entityId", "position");
