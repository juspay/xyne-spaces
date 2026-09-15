-- Activities.updatedAt no longer auto-bumps on Prisma updates:
-- the activity feed sorts by updatedAt desc, so background writes
-- (classification pipeline, markAsRead) must not re-sort rows. The column
-- keeps its creation value; update paths that intentionally re-sort the
-- feed (reaction/reply bubbling) pass updatedAt explicitly from the app.
-- AlterTable
ALTER TABLE "public"."activities" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
