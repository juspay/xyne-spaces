-- Track the creator of a user group so non-admin users can see only groups they created.
-- Nullable: pre-existing groups have no known creator and will not appear in creator-scoped views.

-- AlterTable
ALTER TABLE "public"."user_groups" ADD COLUMN "createdBy" TEXT;

-- CreateIndex
-- Indexes the createdBy filter used by User Groups creator-scoped visibility.
CREATE INDEX "user_groups_createdBy_idx" ON "public"."user_groups"("createdBy");
