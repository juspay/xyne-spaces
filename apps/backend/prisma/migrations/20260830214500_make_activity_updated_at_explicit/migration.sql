-- Activity.updatedAt is the event timestamp used for feed ordering. Prisma must
-- not rewrite it for read-state, classification, or maintenance updates.
ALTER TABLE "activities"
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
