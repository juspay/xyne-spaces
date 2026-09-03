-- AlterTable
-- Nullable (not NOT NULL): a NOT NULL column requires every writer to supply it,
-- including Zero's generic CRUD insert mutator for `calls` — an old client bundle
-- still running pre-deploy code would omit `visibility` and have its insert
-- rejected during a rolling deploy. Nullable + DEFAULT lets Postgres fill it in for
-- writes that omit the column while app code treats a null value as PRIVATE.
ALTER TABLE "public"."calls" ADD COLUMN     "visibility" TEXT DEFAULT 'PRIVATE';
