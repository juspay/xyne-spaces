-- AlterTable
ALTER TABLE "public"."workflows"
    ADD COLUMN "deskOwnerId" TEXT,
    ADD COLUMN "deskChannelId" TEXT,
    ADD COLUMN "deskLabelId" TEXT,
    ADD COLUMN "deskFilterFingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workflows_desk_auto_label_dedupe_key"
    ON "public"."workflows"("workspaceId", "workflowType", "deskOwnerId", "deskChannelId", "deskLabelId", "deskFilterFingerprint");

-- CreateIndex
CREATE INDEX "workflows_desk_owner_channel_idx"
    ON "public"."workflows"("workspaceId", "workflowType", "deskOwnerId", "deskChannelId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "workflows_desk_event_channel_idx"
    ON "public"."workflows"("workspaceId", "workflowType", "deskChannelId", "eventType", "status");

-- CreateIndex
CREATE INDEX "workflows_desk_label_idx"
    ON "public"."workflows"("workspaceId", "deskLabelId");
