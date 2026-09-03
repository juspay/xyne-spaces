-- CreateTable
CREATE TABLE "artifact_app_records" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "baseKey" TEXT NOT NULL,
    "dynamicKey" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_app_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_records_workspaceId_appId_baseKey_owner_dynami_key" ON "artifact_app_records"("workspaceId", "appId", "baseKey", "owner", "dynamicKey");

-- CreateIndex
CREATE INDEX "artifact_app_records_workspaceId_appId_idx" ON "artifact_app_records"("workspaceId", "appId");
