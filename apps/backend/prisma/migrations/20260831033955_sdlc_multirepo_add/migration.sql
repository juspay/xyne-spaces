-- AlterTable
ALTER TABLE "public"."sdlc_artifacts" ALTER COLUMN "repoId" DROP NOT NULL;

-- AlterTable
-- Left nullable for the rows written before multi-repo; the backfill stamps them.
-- Prisma models it as required so no new write can omit the edge's scope.
ALTER TABLE "public"."sdlc_entity_links" ADD COLUMN     "channelId" TEXT,
ALTER COLUMN "repoId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."sdlc_tracks" ALTER COLUMN "repoId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "sdlc_entity_links_workspaceId_idx" ON "public"."sdlc_entity_links"("workspaceId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_channelId_relationType_idx" ON "public"."sdlc_entity_links"("channelId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_sourceType_sourceId_relationType_idx" ON "public"."sdlc_entity_links"("sourceType", "sourceId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_targetType_targetId_relationType_idx" ON "public"."sdlc_entity_links"("targetType", "targetId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "sdlc_entity_links_channel_edge_key" ON "public"."sdlc_entity_links"("channelId", "sourceType", "sourceId", "targetType", "targetId", "relationType");

