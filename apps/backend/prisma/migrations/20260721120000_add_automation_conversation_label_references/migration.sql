-- Prisma model: DeskAutoLabelRuleReference.
-- Server-only index for personal Desk auto-label rules that target private conversation labels.
-- No foreign keys: this datasource uses relationMode = "prisma".
CREATE TABLE "non_zero"."desk_auto_label_rule_references" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "filterFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_auto_label_rule_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "desk_auto_label_rule_references_workflowId_labelId_key"
    ON "non_zero"."desk_auto_label_rule_references"("workflowId", "labelId");

CREATE INDEX "desk_auto_label_rule_refs_owner_channel_idx"
    ON "non_zero"."desk_auto_label_rule_references"
    ("workspaceId", "ownerId", "channelId", "createdAt" DESC, "id" DESC);

CREATE INDEX "desk_auto_label_rule_refs_channel_idx"
    ON "non_zero"."desk_auto_label_rule_references"
    ("workspaceId", "channelId");

CREATE INDEX "desk_auto_label_rule_refs_label_idx"
    ON "non_zero"."desk_auto_label_rule_references"
    ("workspaceId", "labelId");

CREATE UNIQUE INDEX "desk_auto_label_rule_refs_filter_key"
    ON "non_zero"."desk_auto_label_rule_references"
    ("workspaceId", "ownerId", "channelId", "labelId", "filterFingerprint");
