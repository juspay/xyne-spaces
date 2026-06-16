-- CreateEnum
CREATE TYPE "public"."TagMethod" AS ENUM ('MANUAL', 'LLM', 'AUTOMATED');

-- CreateTable
CREATE TABLE "public"."tags" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tagCategory" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "method" "public"."TagMethod" NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tags_config" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tags_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tags_sourceId_sourceType_tagCategory_idx" ON "public"."tags"("sourceId", "sourceType", "tagCategory");

-- CreateIndex
CREATE INDEX "tags_sourceType_tagCategory_tag_idx" ON "public"."tags"("sourceType", "tagCategory", "tag");

-- CreateIndex
CREATE INDEX "tags_config_configKey_isDeleted_idx" ON "public"."tags_config"("configKey", "isDeleted");

-- CreateIndex
CREATE INDEX "tags_workspaceId_sourceType_tagCategory_idx" ON "public"."tags"("workspaceId", "sourceType", "tagCategory");

-- CreateIndex
CREATE INDEX "tags_config_sourceType_workspaceId_isDeleted_idx" ON "public"."tags_config"("sourceType", "workspaceId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "tags_active_unique"
  ON "public"."tags" ("sourceId", "sourceType", "tagCategory", "tag")
  WHERE "isDeleted" = false;

-- CreateIndex
CREATE UNIQUE INDEX "tags_config_active_unique"
  ON "public"."tags_config" ("configKey")
  WHERE "isDeleted" = false;
