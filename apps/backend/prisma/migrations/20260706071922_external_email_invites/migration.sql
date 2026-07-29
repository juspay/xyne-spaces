/*
  Warnings:

  - A unique constraint covering the columns `[callId,email]` on the table `call_participants` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."call_participants" ADD COLUMN     "email" TEXT;

-- CreateTable
CREATE TABLE "public"."recurring_call_participants" (
    "id" TEXT NOT NULL,
    "recurringSeriesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL,
    "response" "public"."InvitationResponse",
    "meetingStatus" "public"."MeetingStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "displayName" TEXT,
    "email" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recurring_call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_call_participants_recurringSeriesId_idx" ON "public"."recurring_call_participants"("recurringSeriesId");

-- CreateIndex
CREATE INDEX "recurring_call_participants_userId_idx" ON "public"."recurring_call_participants"("userId");

-- CreateIndex
CREATE INDEX "recurring_call_participants_email_idx" ON "public"."recurring_call_participants"("email");

-- CreateIndex
CREATE INDEX "recurring_call_participants_isExternal_idx" ON "public"."recurring_call_participants"("isExternal");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_call_participants_recurringSeriesId_userId_key" ON "public"."recurring_call_participants"("recurringSeriesId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_call_participants_recurringSeriesId_email_key" ON "public"."recurring_call_participants"("recurringSeriesId", "email");

-- CreateIndex
CREATE INDEX "call_participants_email_idx" ON "public"."call_participants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_callId_email_key" ON "public"."call_participants"("callId", "email");
