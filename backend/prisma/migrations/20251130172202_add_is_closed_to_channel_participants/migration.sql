-- AlterTable
ALTER TABLE "channel_participants" ADD COLUMN     "isClosed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "channel_participants_userId_isClosed_idx" ON "channel_participants"("userId", "isClosed");
