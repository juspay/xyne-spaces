-- Allow group and channel/DM share targets on canvas participants (user rows use userId only).

ALTER TABLE "public"."canvas_participants"
ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN "userGroupId" TEXT,
ADD COLUMN "channelId" TEXT;

CREATE UNIQUE INDEX "canvas_participants_canvasId_userGroupId_key"
ON "public"."canvas_participants"("canvasId", "userGroupId");

CREATE UNIQUE INDEX "canvas_participants_canvasId_channelId_key"
ON "public"."canvas_participants"("canvasId", "channelId");

CREATE INDEX "canvas_participants_userGroupId_idx"
ON "public"."canvas_participants"("userGroupId");

CREATE INDEX "canvas_participants_channelId_idx"
ON "public"."canvas_participants"("channelId");

-- No foreign key constraints on userGroupId/channelId to stay consistent
-- with userId and canvasId which also have no FK constraints.
