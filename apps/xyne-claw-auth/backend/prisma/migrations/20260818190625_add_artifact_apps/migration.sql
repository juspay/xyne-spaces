-- CreateTable
CREATE TABLE "artifact_apps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "publishedVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_app_versions" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artifact_apps_workspaceId_visibility_idx" ON "artifact_apps"("workspaceId", "visibility");

-- CreateIndex
CREATE INDEX "artifact_apps_ownerUserId_idx" ON "artifact_apps"("ownerUserId");

-- CreateIndex
CREATE INDEX "artifact_app_versions_appId_createdAt_idx" ON "artifact_app_versions"("appId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_versions_appId_contentHash_key" ON "artifact_app_versions"("appId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_versions_appId_versionNumber_key" ON "artifact_app_versions"("appId", "versionNumber");

-- AddForeignKey
ALTER TABLE "artifact_app_versions" ADD CONSTRAINT "artifact_app_versions_appId_fkey" FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

