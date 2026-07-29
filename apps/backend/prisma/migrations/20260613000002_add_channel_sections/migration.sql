-- Prisma model: ChannelSection (mapped to table "channel_sections").
-- Adds the channel_sections table + sectionId/sectionPosition columns on channel_user_status.
-- Ordering columns (position, sectionPosition) are TEXT string fractional indexes
-- (generateKeyBetween), matching the repo's kanbanPosition convention.

-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "sectionPosition" TEXT;

-- CreateTable
CREATE TABLE "public"."channel_sections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "position" TEXT NOT NULL,
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "channel_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_sections_userId_workspaceId_isDeleted_idx" ON "public"."channel_sections"("userId", "workspaceId", "isDeleted");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_sectionId_idx" ON "public"."channel_user_status"("userId", "sectionId");
