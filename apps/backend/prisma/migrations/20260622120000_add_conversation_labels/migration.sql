-- Prisma models: ConversationLabel ("conversation_labels") and
-- ConversationLabelMapping ("conversation_label_mappings").
-- Gmail-style labels for desk/support email conversations: a per-channel, per-user
-- (createdBy) label catalog plus a many-to-many junction attaching labels to
-- conversations (threads). Labels are private to the agent who created them.

-- CreateTable
CREATE TABLE "public"."conversation_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "channelId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-06-30T08:55:30.101491Z',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_label_mappings" (
    "id" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-06-30T08:55:30.101491Z',

    CONSTRAINT "conversation_label_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Dup-name guard; the (channelId, createdBy) prefix also serves catalog reads + ACL,
-- and the trailing "name" matches the catalog query's orderBy('name').
CREATE UNIQUE INDEX "conversation_labels_channelId_createdBy_name_key" ON "public"."conversation_labels"("channelId", "createdBy", "name");

-- CreateIndex
-- Apply-once guard; the conversationId prefix also serves the per-thread chips read.
CREATE UNIQUE INDEX "conversation_label_mappings_conversationId_labelId_key" ON "public"."conversation_label_mappings"("conversationId", "labelId");

-- CreateIndex
-- Label-panel read, label→mappings correlation, deleteLabel cascade.
CREATE INDEX "conversation_label_mappings_labelId_idx" ON "public"."conversation_label_mappings"("labelId");
