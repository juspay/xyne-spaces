-- Durable mapping from an agent-authored widget/card to WHERE it lives in a
-- Spaces thread + the agent identity that posted it. Generic across widget
-- `kind` ('pr' now; 'plan' etc. later). Lets an inbound git-host webhook that
-- fires long after the run's SessionContext (Redis, 24h) is gone recover the
-- thread + agent (by `externalKey`, e.g. the normalized PR URL) and post a
-- fresh status card. See AgentWidgetBinding in schema.prisma.

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "agent_widget_bindings_kind_screenId_key" ON "agent_widget_bindings"("kind", "screenId");

-- CreateIndex
CREATE INDEX "agent_widget_bindings_kind_externalKey_idx" ON "agent_widget_bindings"("kind", "externalKey");

-- CreateIndex
CREATE INDEX "agent_widget_bindings_orgId_idx" ON "agent_widget_bindings"("orgId");
