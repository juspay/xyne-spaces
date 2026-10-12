-- Every applications row must have its repoId backfilled (its repos.id) before this
-- runs; put the backfill above this statement or run it between the two migrations.
-- AlterTable
ALTER TABLE "public"."applications" ALTER COLUMN "repoId" SET NOT NULL;
