CREATE TABLE "conversation_artifacts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "refService" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "url" TEXT,
    "provider" TEXT,
    "latestVersionRef" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_artifacts_conversationId_kind_refId_key"
    ON "conversation_artifacts"("conversationId", "kind", "refId");

CREATE INDEX "conversation_artifacts_conversationId_createdAt_idx"
    ON "conversation_artifacts"("conversationId", "createdAt");

CREATE INDEX "conversation_artifacts_refService_refId_idx"
    ON "conversation_artifacts"("refService", "refId");

CREATE INDEX "conversation_artifacts_orgId_idx"
    ON "conversation_artifacts"("orgId");
