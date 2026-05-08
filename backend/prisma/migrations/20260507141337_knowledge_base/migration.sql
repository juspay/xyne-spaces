-- CreateEnum
CREATE TYPE "public"."UploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NONE');

-- CreateEnum
CREATE TYPE "public"."CollectionRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."CollectionItemType" AS ENUM ('FOLDER', 'FILE');

-- CreateTable
CREATE TABLE "public"."collections" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT,
    "vespaDocId" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedByEmail" TEXT,
    "lastUpdatedById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_items" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."CollectionItemType" NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "vespaDocId" TEXT,
    "totalFileCount" INTEGER NOT NULL DEFAULT 0,
    "totalFiles" INTEGER DEFAULT 0,
    "pendingFiles" INTEGER DEFAULT 0,
    "processingFiles" INTEGER DEFAULT 0,
    "completedFiles" INTEGER DEFAULT 0,
    "failedFiles" INTEGER DEFAULT 0,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileSize" BIGINT,
    "checksum" TEXT,
    "uploadedByEmail" TEXT,
    "uploadedById" TEXT,
    "processingInfo" JSONB NOT NULL DEFAULT '{}',
    "processedAt" TIMESTAMP(3),
    "uploadStatus" "public"."UploadStatus" NOT NULL DEFAULT 'NONE',
    "statusMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "versionCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_permissions" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT,
    "userGroupId" TEXT,
    "role" "public"."CollectionRole" NOT NULL,
    "canShare" BOOLEAN NOT NULL DEFAULT false,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_item_versions" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedByEmail" TEXT NOT NULL,
    "restoredFromVersionId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_item_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_collections_id_owner" ON "public"."collections"("id", "ownerId");

-- CreateIndex
CREATE INDEX "idx_collections_project_deleted_created_id" ON "public"."collections"("projectId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "idx_collections_deleted_created_id" ON "public"."collections"("deletedAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_owner_collection_name_not_deleted" ON "public"."collections"("ownerId", "name", "projectId");

-- CreateIndex
CREATE INDEX "idx_items_collection_deleted_created_id" ON "public"."collection_items"("collectionId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_collection_parent_name_not_deleted" ON "public"."collection_items"("collectionId", "parentId", "name");

-- CreateIndex
CREATE INDEX "collection_permissions_userGroupId_idx" ON "public"."collection_permissions"("userGroupId");

-- CreateIndex
CREATE INDEX "idx_collection_permissions_collection_user_id" ON "public"."collection_permissions"("collectionId", "userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_userId_key" ON "public"."collection_permissions"("collectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_userGroupId_key" ON "public"."collection_permissions"("collectionId", "userGroupId");

-- CreateIndex
CREATE INDEX "collection_item_versions_itemId_idx" ON "public"."collection_item_versions"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_item_versions_itemId_versionNumber_key" ON "public"."collection_item_versions"("itemId", "versionNumber");
