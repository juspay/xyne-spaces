-- AlterTable
ALTER TABLE "public"."conversations" ADD COLUMN IF NOT EXISTS "callId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_callId_idx" ON "public"."conversations"("callId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_conversationId_callId_idx" ON "public"."conversations"("conversationId", "callId");

-- CreateEnum
CREATE TYPE "CallOrigin" AS ENUM ('CHANNEL', 'CONVERSATION');

-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN IF NOT EXISTS "callOrigin" "CallOrigin" NOT NULL DEFAULT 'CHANNEL';

