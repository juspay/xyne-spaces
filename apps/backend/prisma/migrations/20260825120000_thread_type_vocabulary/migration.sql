CREATE TABLE "non_zero"."thread_type_vocabulary" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_type_vocabulary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thread_type_vocabulary_scope_scopeId_name_key" ON "non_zero"."thread_type_vocabulary"("scope", "scopeId", "name");

CREATE INDEX "thread_type_vocabulary_workspaceId_scope_status_idx" ON "non_zero"."thread_type_vocabulary"("workspaceId", "scope", "status");
