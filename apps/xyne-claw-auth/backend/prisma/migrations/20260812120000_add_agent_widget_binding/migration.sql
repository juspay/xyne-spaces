CREATE TABLE "agent_widget_bindings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "externalKey" TEXT,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "spacesAppId" TEXT NOT NULL,
    "spacesAppUserId" TEXT NOT NULL,
    "agentSlug" TEXT,
    "status" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_widget_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_widget_bindings_scope_key"
    ON "agent_widget_bindings"("kind", "screenId", "conversationId", "spacesAppId");

CREATE INDEX "agent_widget_bindings_kind_externalKey_idx"
    ON "agent_widget_bindings"("kind", "externalKey");

CREATE INDEX "agent_widget_bindings_orgId_idx"
    ON "agent_widget_bindings"("orgId");

CREATE INDEX "agent_widget_bindings_conversationId_updatedAt_idx"
    ON "agent_widget_bindings"("conversationId", "updatedAt");
