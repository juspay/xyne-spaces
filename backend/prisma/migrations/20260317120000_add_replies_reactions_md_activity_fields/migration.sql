-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "replies_md" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "reactions_md" TEXT;

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-03-18T14:40:31.420Z';

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_updatedAt_idx" ON "public"."activities"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_conversationId_userId_idx" ON "public"."activities"("conversationId", "userId");
