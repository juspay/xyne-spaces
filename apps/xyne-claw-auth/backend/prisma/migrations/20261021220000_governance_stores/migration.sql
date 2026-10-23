-- Governance stores (PR-3): the static content registry, scan findings and the hash-chained audit
-- stream, plus orgId on agent_audit_logs so org admins can scope it. Status columns are text on
-- purpose (no enum types). Prisma cannot express the two partial indexes at the end.

-- AlterTable
ALTER TABLE "agent_audit_logs" ADD COLUMN     "orgId" TEXT;
-- CreateTable
CREATE TABLE "static_content_versions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedVia" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "overrideExpiresAt" TIMESTAMP(3),
    "writtenBy" TEXT NOT NULL,
    "writtenByUserId" TEXT,
    "writtenByAgentId" TEXT,
    "writtenInConversationId" TEXT,
    "writtenAtRiskLevel" TEXT,
    "carriesPrivateData" BOOLEAN NOT NULL DEFAULT false,
    "parserVerdict" TEXT,
    "judgeVerdict" TEXT,
    "detonatorVerdict" TEXT,
    "scannerVersion" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "bytesText" TEXT,
    "bytesStoragePath" TEXT,
    "promptVersionId" TEXT,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "static_content_versions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "content_scan_findings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "foundIn" TEXT NOT NULL,
    "staticContentVersionId" TEXT,
    "runId" TEXT,
    "conversationId" TEXT,
    "toolCallId" TEXT,
    "chunkSha256" TEXT,
    "foundByCheck" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleFamily" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "redactedExcerpt" TEXT NOT NULL,
    "scanProfile" TEXT NOT NULL,
    "scannerVersion" TEXT NOT NULL,
    "clearedByUserId" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_scan_findings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "governance_audit_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "orgSequence" INTEGER,
    "previousRowSha256" TEXT,
    "rowSha256" TEXT,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "onBehalfOfUserId" TEXT,
    "actorIp" TEXT,
    "actorUserAgent" TEXT,
    "subjectKind" TEXT,
    "subjectId" TEXT,
    "contentSha256Before" TEXT,
    "contentSha256After" TEXT,
    "agentId" TEXT,
    "runId" TEXT,
    "conversationId" TEXT,
    "toolCallId" TEXT,
    "mcpServerId" TEXT,
    "toolName" TEXT,
    "traceId" TEXT,
    "spanId" TEXT,
    "decision" TEXT,
    "reasonCode" TEXT,
    "reasonText" TEXT,
    "policyVersion" TEXT,
    "scannerVersion" TEXT,
    "matchedRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "findingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkTierReached" TEXT,
    "parserMs" INTEGER,
    "judgeMs" INTEGER,
    "gateMs" INTEGER,
    "outcome" TEXT,
    "toolEffect" TEXT,
    "destinationKind" TEXT,
    "destinationHost" TEXT,
    "riskLevelAtCall" TEXT,
    "carriedPrivateData" BOOLEAN,
    "argumentsRedacted" TEXT,
    "approvalId" TEXT,
    "loadedVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "governance_audit_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "static_content_versions_orgId_subjectKey_createdAt_idx" ON "static_content_versions"("orgId", "subjectKey", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "static_content_versions_orgId_subjectKey_contentSha256_key" ON "static_content_versions"("orgId", "subjectKey", "contentSha256");
-- CreateIndex
CREATE INDEX "content_scan_findings_orgId_conversationId_clearedAt_idx" ON "content_scan_findings"("orgId", "conversationId", "clearedAt");
-- CreateIndex
CREATE INDEX "content_scan_findings_staticContentVersionId_idx" ON "content_scan_findings"("staticContentVersionId");
-- CreateIndex
CREATE INDEX "governance_audit_events_orgId_occurredAt_idx" ON "governance_audit_events"("orgId", "occurredAt");
-- CreateIndex
CREATE UNIQUE INDEX "governance_audit_events_orgId_orgSequence_key" ON "governance_audit_events"("orgId", "orgSequence");
-- CreateIndex
CREATE INDEX "agent_audit_logs_orgId_createdAt_idx" ON "agent_audit_logs"("orgId", "createdAt");
-- CreateIndex
CREATE INDEX "agent_audit_logs_targetId_createdAt_idx" ON "agent_audit_logs"("targetId", "createdAt");
-- AddForeignKey
ALTER TABLE "content_scan_findings" ADD CONSTRAINT "content_scan_findings_staticContentVersionId_fkey" FOREIGN KEY ("staticContentVersionId") REFERENCES "static_content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One tool_call event per tool call, unique per run; other event types are not keyed by tool call.

CREATE UNIQUE INDEX "governance_audit_events_tool_call_key" ON "governance_audit_events"("orgId", "runId", "toolCallId") WHERE "eventType" = 'tool_call';



-- The sequencer reads only rows it has not chained yet; this keeps that read small as the table grows.

CREATE INDEX "governance_audit_events_unchained_idx" ON "governance_audit_events"("orgId", "occurredAt") WHERE "orgSequence" IS NULL;
