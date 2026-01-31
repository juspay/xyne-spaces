-- CreateEnum
CREATE TYPE "BookmarkEntityType" AS ENUM ('MESSAGE', 'CONVERSATION', 'TICKET', 'CANVAS');

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" "BookmarkEntityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookmarks_userId_entityType_idx" ON "bookmarks"("userId", "entityType");

-- CreateIndex
CREATE INDEX "bookmarks_userId_createdAt_idx" ON "bookmarks"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_userId_entityId_entityType_key" ON "bookmarks"("userId", "entityId", "entityType");
