-- AlterTable
ALTER TABLE "public"."user_group_mappings" ADD COLUMN     "onCallSetNumbers" INTEGER[];

-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_onCallSetNumbers_idx" ON "public"."user_group_mappings"("userGroupId", "onCallSetNumbers");
