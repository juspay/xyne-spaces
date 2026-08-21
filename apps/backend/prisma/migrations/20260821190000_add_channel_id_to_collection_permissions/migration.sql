-- AlterTable
ALTER TABLE "public"."collection_permissions" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE INDEX "collection_permissions_channelId_idx" ON "public"."collection_permissions"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_channelId_key" ON "public"."collection_permissions"("collectionId", "channelId");
