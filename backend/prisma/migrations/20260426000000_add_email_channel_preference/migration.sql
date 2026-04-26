-- CreateTable
CREATE TABLE "public"."email_channel_preferences" (
    "channelId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "assigneeUserGroupId" TEXT,
    "boardId" TEXT,

    CONSTRAINT "email_channel_preferences_pkey" PRIMARY KEY ("channelId")
);

-- CreateIndex
CREATE INDEX "email_channel_preferences_ownerUserId_idx" ON "public"."email_channel_preferences"("ownerUserId");

-- CreateIndex
CREATE INDEX "email_channel_preferences_assigneeUserGroupId_idx" ON "public"."email_channel_preferences"("assigneeUserGroupId");

-- CreateIndex
CREATE INDEX "email_channel_preferences_boardId_idx" ON "public"."email_channel_preferences"("boardId");
