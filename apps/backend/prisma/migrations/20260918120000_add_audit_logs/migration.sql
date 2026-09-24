-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log_changes" (
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

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "public"."audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "public"."audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_changes_auditLogId_idx" ON "public"."audit_log_changes"("auditLogId");

-- CreateIndex
CREATE INDEX "audit_log_changes_tableName_recordId_idx" ON "public"."audit_log_changes"("tableName", "recordId");

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_log_changes" ADD CONSTRAINT "audit_log_changes_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "public"."audit_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
