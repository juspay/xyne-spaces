-- Additive channel-to-board mapping infrastructure. Existing projectId columns
-- remain unchanged for rolling-deployment compatibility.

-- CreateTable
CREATE TABLE "public"."channel_board_mappings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_board_mappings_pkey" PRIMARY KEY ("id")
);

-- A board can be linked to a channel only once.
CREATE UNIQUE INDEX "channel_board_mappings_channelId_boardId_key"
    ON "public"."channel_board_mappings"("channelId", "boardId");

-- A channel can have at most one default board. Prisma cannot express this
-- partial unique index in schema.prisma.
CREATE UNIQUE INDEX "channel_board_mappings_one_default_per_channel"
    ON "public"."channel_board_mappings"("channelId")
    WHERE "isDefault" = true;

CREATE INDEX "channel_board_mappings_channelId_idx"
    ON "public"."channel_board_mappings"("channelId");

CREATE INDEX "channel_board_mappings_boardId_idx"
    ON "public"."channel_board_mappings"("boardId");

CREATE INDEX "channel_board_mappings_workspaceId_channelId_idx"
    ON "public"."channel_board_mappings"("workspaceId", "channelId");
