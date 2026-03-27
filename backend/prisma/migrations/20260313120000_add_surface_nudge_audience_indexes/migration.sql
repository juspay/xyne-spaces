-- AlterTable
ALTER TABLE "public"."surface_nudges"
ADD COLUMN "surfaceNudgeCountId" TEXT;

-- CreateTable
CREATE TABLE "public"."surface_nudge_counts" (
    "id" TEXT NOT NULL,
    "nudgeCount" INTEGER NOT NULL,
    "userId" TEXT,
    "channelId" TEXT,
    "gid" TEXT,
    "gidType" TEXT,
    "messageId" TEXT,
    "ticketId" TEXT,
    "canvasId" TEXT,
    "callId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_nudge_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surface_nudges_surfaceNudgeCountId_state_idx" ON "public"."surface_nudges"("surfaceNudgeCountId", "state");

CREATE INDEX "surface_nudge_counts_messageId_userId_idx" ON "public"."surface_nudge_counts"("messageId", "userId");
CREATE INDEX "surface_nudge_counts_messageId_channelId_idx" ON "public"."surface_nudge_counts"("messageId", "channelId");
CREATE INDEX "surface_nudge_counts_messageId_gid_gidType_idx" ON "public"."surface_nudge_counts"("messageId", "gid", "gidType");
CREATE INDEX "surface_nudge_counts_ticketId_userId_idx" ON "public"."surface_nudge_counts"("ticketId", "userId");
CREATE INDEX "surface_nudge_counts_ticketId_channelId_idx" ON "public"."surface_nudge_counts"("ticketId", "channelId");
CREATE INDEX "surface_nudge_counts_ticketId_gid_gidType_idx" ON "public"."surface_nudge_counts"("ticketId", "gid", "gidType");
CREATE INDEX "surface_nudge_counts_canvasId_userId_idx" ON "public"."surface_nudge_counts"("canvasId", "userId");
CREATE INDEX "surface_nudge_counts_canvasId_channelId_idx" ON "public"."surface_nudge_counts"("canvasId", "channelId");
CREATE INDEX "surface_nudge_counts_canvasId_gid_gidType_idx" ON "public"."surface_nudge_counts"("canvasId", "gid", "gidType");
CREATE INDEX "surface_nudge_counts_callId_userId_idx" ON "public"."surface_nudge_counts"("callId", "userId");
CREATE INDEX "surface_nudge_counts_callId_channelId_idx" ON "public"."surface_nudge_counts"("callId", "channelId");
CREATE INDEX "surface_nudge_counts_callId_gid_gidType_idx" ON "public"."surface_nudge_counts"("callId", "gid", "gidType");
CREATE INDEX "surface_nudge_counts_conversationId_userId_idx" ON "public"."surface_nudge_counts"("conversationId", "userId");
CREATE INDEX "surface_nudge_counts_conversationId_channelId_idx" ON "public"."surface_nudge_counts"("conversationId", "channelId");
CREATE INDEX "surface_nudge_counts_conversationId_gid_gidType_idx" ON "public"."surface_nudge_counts"("conversationId", "gid", "gidType");
