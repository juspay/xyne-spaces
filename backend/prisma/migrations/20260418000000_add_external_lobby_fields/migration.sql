-- AlterEnum
ALTER TYPE "public"."InvitationResponse" ADD VALUE 'REQUESTED';

-- AlterTable
ALTER TABLE "public"."call_participants"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "non_zero"."call_messages" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_messages_callId_createdAt_idx" ON "non_zero"."call_messages"("callId", "createdAt");
