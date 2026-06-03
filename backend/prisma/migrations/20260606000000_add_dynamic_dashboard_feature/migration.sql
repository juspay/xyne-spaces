-- CreateEnum
CREATE TYPE "public"."DashboardVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."DashboardRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."QueryType" AS ENUM ('internal', 'external');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'AREA_CHART';
ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'KPI_COMPARE';
ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'SCATTER_CHART';

-- AlterTable
-- `workspaceId` defaults to '' for existing rows; run the backfill endpoint
-- (POST /api/admin/dashboard-workspace-id-backfill) to populate from each
-- dashboard's creator workspace. A follow-up migration drops the DEFAULT and
-- adds the (workspaceId, name) UNIQUE INDEX once all environments are backfilled.
ALTER TABLE "public"."dashboards" ADD COLUMN     "config" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "visibility" "public"."DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "workspaceId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "public"."queries" ADD COLUMN     "config" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "position" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "queryType" "public"."QueryType" NOT NULL DEFAULT 'internal',
ALTER COLUMN "title" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workflow"."data_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "ingestionStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."data_source_tables" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowCountEstimate" BIGINT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."data_source_columns" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "pkPosition" INTEGER,
    "dataTypeNative" TEXT NOT NULL,
    "dataTypeCanonical" TEXT NOT NULL,
    "cardinality" TEXT,
    "isNullable" BOOLEAN NOT NULL,
    "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "displayUnit" TEXT,
    "summary" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."data_source_relationships" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "fromColumnId" TEXT NOT NULL,
    "toColumnId" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dashboard_participants" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."DashboardRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."dashboard_activity" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_sources_workspaceId_idx" ON "workflow"."data_sources"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_workspaceId_name_key" ON "workflow"."data_sources"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "data_source_tables_dataSourceId_idx" ON "workflow"."data_source_tables"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_tables_dataSourceId_schemaName_tableName_key" ON "workflow"."data_source_tables"("dataSourceId", "schemaName", "tableName");

-- CreateIndex
CREATE INDEX "data_source_columns_tableId_idx" ON "workflow"."data_source_columns"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_columns_tableId_columnName_key" ON "workflow"."data_source_columns"("tableId", "columnName");

-- CreateIndex
CREATE INDEX "data_source_relationships_dataSourceId_idx" ON "workflow"."data_source_relationships"("dataSourceId");

-- CreateIndex
CREATE INDEX "data_source_relationships_fromColumnId_idx" ON "workflow"."data_source_relationships"("fromColumnId");

-- CreateIndex
CREATE INDEX "data_source_relationships_toColumnId_idx" ON "workflow"."data_source_relationships"("toColumnId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_relationships_fromColumnId_toColumnId_key" ON "workflow"."data_source_relationships"("fromColumnId", "toColumnId");

-- CreateIndex
CREATE INDEX "dashboard_participants_dashboardId_idx" ON "public"."dashboard_participants"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_participants_userId_idx" ON "public"."dashboard_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_participants_dashboardId_userId_key" ON "public"."dashboard_participants"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "dashboard_activity_entityType_entityId_createdAt_idx" ON "workflow"."dashboard_activity"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_createdAt_idx" ON "workflow"."dashboard_activity"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_actorUserId_idx" ON "workflow"."dashboard_activity"("actorUserId");

-- CreateIndex
CREATE INDEX "dashboards_workspaceId_idx" ON "public"."dashboards"("workspaceId");

-- CreateIndex
CREATE INDEX "dashboards_createdBy_idx" ON "public"."dashboards"("createdBy");

-- NOTE: UNIQUE INDEX "dashboards_workspaceId_name_key" on ("workspaceId", "name")
-- is intentionally deferred to a follow-up migration. Existing rows default to
-- workspaceId='', so any two dashboards sharing a name would collide here.
-- Run the backfill endpoint first, then the follow-up migration adds the index
-- and drops the '' DEFAULT.

-- CreateIndex
CREATE INDEX "queries_queryType_idx" ON "public"."queries"("queryType");

-- CreateIndex
CREATE INDEX "dashboard_queries_mapping_queryId_idx" ON "public"."dashboard_queries_mapping"("queryId");
