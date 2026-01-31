-- Split channel_participants into two tables
-- This migration was applied via db push, documenting the changes:


-- 2. Create new channel_user_status table
-- CreateTable
CREATE TABLE "channel_user_status" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" BIGINT NOT NULL,
    "lastViewedConversationId" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "channel_user_status_pkey" PRIMARY KEY ("id")
);

-- 3. Create indexes
-- CreateIndex
CREATE INDEX "channel_user_status_channelId_idx" ON "channel_user_status"("channelId");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_idx" ON "channel_user_status"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_user_status_channelId_userId_key" ON "channel_user_status"("channelId", "userId");



-- Note: This migration file documents changes that were already applied to the database via `prisma db push`
-- The database is already in sync with the schema
