-- CreateEnum
CREATE TYPE "public"."NudgeType" AS ENUM (
    'EXISTING_TICKET',
    'CREATE_TICKET',
    'SET_REMINDER',
    'ADD_TO_KB',
    'REVERSE_KB_LOOKUP',
    'THREAD_FOLLOW_UP',
    'DECISION_PENDING',
    'WAITING_ON_BLOCKED_BY'
);

-- AlterTable
ALTER TABLE "public"."messages"
ADD COLUMN "nudgeCount" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."proactive_nudges" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "public"."NudgeType" NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceSpans" TEXT NOT NULL,
    "actions" JSONB,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proactive_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proactive_nudges_state_idx" ON "public"."proactive_nudges"("state");

-- CreateIndex
CREATE UNIQUE INDEX "proactive_nudges_messageId_key" ON "public"."proactive_nudges"("messageId");
