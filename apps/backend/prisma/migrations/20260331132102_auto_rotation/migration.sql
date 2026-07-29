
-- CreateEnum
CREATE TYPE "public"."RotationInterval" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
​
-- AlterTable
ALTER TABLE "public"."user_group_mappings" ADD COLUMN     "onCallSetNumber" INTEGER;
​
-- AlterTable
ALTER TABLE "public"."user_groups" ADD COLUMN     "autoRotationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotationInterval" "public"."RotationInterval",
ADD COLUMN     "rotationStartDate" TIMESTAMP(3);
​
-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_onCallSetNumber_idx" ON "public"."user_group_mappings"("userGroupId", "onCallSetNumber");