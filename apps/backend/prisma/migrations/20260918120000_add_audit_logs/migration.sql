-- CreateTable
CREATE TABLE "non_zero"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."audit_log_changes" (
    "id" TEXT NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "audit_log_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (query path: workspace-scoped feed filter + ordering + keyset slicing)
CREATE INDEX "audit_logs_workspaceId_entityType_entityId_createdAt_idx" ON "non_zero"."audit_logs"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex (FK trigger scan on user deletion)
CREATE INDEX "audit_logs_actorUserId_idx" ON "non_zero"."audit_logs"("actorUserId");

-- CreateIndex (FK trigger + parent -> children include)
CREATE INDEX "audit_log_changes_auditLogId_idx" ON "non_zero"."audit_log_changes"("auditLogId");

