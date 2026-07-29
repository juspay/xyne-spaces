-- AlterTable
ALTER TABLE "public"."emails" ADD COLUMN     "rfcMessageId" TEXT;

-- CreateIndex
CREATE INDEX "emails_channelId_rfcMessageId_idx" ON "public"."emails"("channelId", "rfcMessageId");
