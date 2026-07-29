-- CreateEnum
CREATE TYPE "non_zero"."TagMethod" AS ENUM ('MANUAL', 'LLM', 'AUTOMATED');

-- CreateTable
CREATE TABLE "non_zero"."tags" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "configKey" TEXT,
    "tagCategory" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "method" "non_zero"."TagMethod" NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."tags_config" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL,

    CONSTRAINT "tags_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tags_sourceId_sourceType_tagCategory_idx"
  ON "non_zero"."tags"("sourceId", "sourceType", "tagCategory");

-- CreateIndex
CREATE INDEX "tags_workspaceId_sourceType_configKey_tagCategory_tag_idx"
  ON "non_zero"."tags"("workspaceId", "sourceType", "configKey", "tagCategory", "tag");

-- CreateIndex
CREATE INDEX "tags_config_configKey_isDeleted_idx"
  ON "non_zero"."tags_config"("configKey", "isDeleted");

-- CreateIndex
CREATE INDEX "tags_config_sourceType_workspaceId_isDeleted_idx"
  ON "non_zero"."tags_config"("sourceType", "workspaceId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "tags_active_unique"
  ON "non_zero"."tags"("sourceId", "sourceType", "tagCategory", "tag")
  WHERE "isDeleted" = false;

-- CreateIndex
CREATE UNIQUE INDEX "tags_config_active_unique"
  ON "non_zero"."tags_config"("configKey")
  WHERE "isDeleted" = false;