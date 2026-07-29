-- CreateEnum
CREATE TYPE "public"."IngestionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NONE');

-- CreateEnum
CREATE TYPE "public"."CollectionRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable
-- Collection serves as BOTH the root collection AND any sub-folder.
-- parentId = null  →  root collection (has its own permissions)
-- parentId = <id>  →  sub-folder whose parent is that Collection row
-- scopeType = 'CHANNEL', scopeId = <channelId> for current usage.
-- Future scopes (THREAD, TICKET, etc.) require no schema changes.
CREATE TABLE "public"."collections" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "description" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "rootCollectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- CollectionItem holds FILES only (no folders — those are Collection rows).
-- fileId is a stable UUID shared across all versions of the same file.
-- isLatest = true  →  current version, visible in folder listings
-- isLatest = false →  historical version, hidden from normal listings
CREATE TABLE "public"."collection_items" (
    "id" TEXT NOT NULL,
    "rootCollectionId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploadedById" TEXT,
    "ingestionStatus" "public"."IngestionStatus" NOT NULL DEFAULT 'NONE',
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (collections)
CREATE UNIQUE INDEX "unique_collection_parent_name" ON "public"."collections"("parentId", "name");
CREATE INDEX "idx_collections_id_owner" ON "public"."collections"("id", "ownerId");
CREATE INDEX "idx_collections_root_collection_deleted" ON "public"."collections"("rootCollectionId", "deletedAt");
CREATE INDEX "idx_collections_scope_deleted" ON "public"."collections"("scopeType", "scopeId", "deletedAt");
CREATE INDEX "idx_collections_deleted_created_id" ON "public"."collections"("deletedAt", "createdAt", "id");
CREATE INDEX "idx_collections_parent_deleted" ON "public"."collections"("parentId", "deletedAt");

-- CreateIndex (collection_items)
CREATE INDEX "idx_items_file_id" ON "public"."collection_items"("fileId");
CREATE INDEX "idx_items_root_collection_latest" ON "public"."collection_items"("rootCollectionId", "isLatest", "deletedAt", "createdAt", "id");
CREATE INDEX "idx_items_collection_latest" ON "public"."collection_items"("collectionId", "isLatest", "deletedAt", "createdAt", "id");

-- CreateIndex (collection_permissions)
CREATE UNIQUE INDEX "collection_permissions_collectionId_userId_key" ON "public"."collection_permissions"("collectionId", "userId");
CREATE UNIQUE INDEX "collection_permissions_collectionId_userGroupId_key" ON "public"."collection_permissions"("collectionId", "userGroupId");
CREATE INDEX "collection_permissions_userGroupId_idx" ON "public"."collection_permissions"("userGroupId");
CREATE INDEX "idx_collection_permissions_collection_user_id" ON "public"."collection_permissions"("collectionId", "userId", "id");

-- Add COLLECTION to AttachmentEntityType enum (defined in prior migration)
ALTER TYPE "public"."AttachmentEntityType" ADD VALUE IF NOT EXISTS 'COLLECTION';
