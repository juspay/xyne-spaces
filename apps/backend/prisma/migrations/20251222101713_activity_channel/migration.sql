-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE INDEX "activities_channelId_idx" ON "activities"("channelId");
