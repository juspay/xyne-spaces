-- AlterTable
ALTER TABLE "public"."activities" ADD COLUMN     "savedViewId" TEXT;

-- CreateIndex
CREATE INDEX "activities_savedViewId_idx" ON "public"."activities"("savedViewId");
