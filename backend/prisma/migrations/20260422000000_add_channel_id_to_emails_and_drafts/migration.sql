-- AlterTable
ALTER TABLE "public"."emails" ADD COLUMN "channelId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."email_drafts" ADD COLUMN "channelId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "emails_channelId_idx" ON "public"."emails"("channelId");

-- CreateIndex
CREATE INDEX "email_drafts_channelId_idx" ON "public"."email_drafts"("channelId");
