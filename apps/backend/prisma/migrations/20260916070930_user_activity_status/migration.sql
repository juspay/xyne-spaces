-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "activityStatus" TEXT;

-- CreateIndex
CREATE INDEX "users_activityStatus_idx" ON "public"."users"("activityStatus");
