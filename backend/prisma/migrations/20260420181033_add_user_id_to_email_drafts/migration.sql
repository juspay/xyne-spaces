-- AlterTable
ALTER TABLE "public"."email_drafts" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "email_drafts_userId_conversationId_id_idx" ON "public"."email_drafts"("userId", "conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "email_drafts_userId_conversationId_key" ON "public"."email_drafts"("userId", "conversationId");

