-- CreateEnum
CREATE TYPE "non_zero"."DashboardVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "non_zero"."DashboardRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "non_zero"."QueryType" AS ENUM ('internal', 'external');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'AREA_CHART';
ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'KPI_COMPARE';
ALTER TYPE "public"."QueryVisualizationType" ADD VALUE 'SCATTER_CHART';

ALTER TABLE "public"."queries" ADD COLUMN IF NOT EXISTS "position" TEXT;

-- CreateTable
CREATE TABLE "non_zero"."data_sources" (
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
CREATE TABLE "non_zero"."data_source_tables" (
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
CREATE TABLE "non_zero"."data_source_columns" (
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
CREATE TABLE "non_zero"."data_source_relationships" (
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
CREATE TABLE "non_zero"."dynamic_dashboards" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "visibility" "non_zero"."DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dashboard_participants" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "non_zero"."DashboardRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dashboard_activity" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dynamic_dashboard_queries" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "queryType" "non_zero"."QueryType" NOT NULL DEFAULT 'internal',
    "queryJson" JSONB NOT NULL,
    "entityType" "public"."FormEntityType",
    "targetEntity" TEXT,
    "visualType" "public"."QueryVisualizationType",
    "position" TEXT NOT NULL DEFAULT '{}',
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboard_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dynamic_dashboard_queries_mapping" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboard_queries_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_sources_workspaceId_idx" ON "non_zero"."data_sources"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_workspaceId_name_key" ON "non_zero"."data_sources"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "data_source_tables_dataSourceId_idx" ON "non_zero"."data_source_tables"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_tables_dataSourceId_schemaName_tableName_key" ON "non_zero"."data_source_tables"("dataSourceId", "schemaName", "tableName");

-- CreateIndex
CREATE INDEX "data_source_columns_tableId_idx" ON "non_zero"."data_source_columns"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_columns_tableId_columnName_key" ON "non_zero"."data_source_columns"("tableId", "columnName");

-- CreateIndex
CREATE INDEX "data_source_relationships_dataSourceId_idx" ON "non_zero"."data_source_relationships"("dataSourceId");

-- CreateIndex
CREATE INDEX "data_source_relationships_fromColumnId_idx" ON "non_zero"."data_source_relationships"("fromColumnId");

-- CreateIndex
CREATE INDEX "data_source_relationships_toColumnId_idx" ON "non_zero"."data_source_relationships"("toColumnId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_relationships_fromColumnId_toColumnId_key" ON "non_zero"."data_source_relationships"("fromColumnId", "toColumnId");

-- CreateIndex
CREATE INDEX "dynamic_dashboards_workspaceId_idx" ON "non_zero"."dynamic_dashboards"("workspaceId");

-- CreateIndex
CREATE INDEX "dynamic_dashboards_createdBy_idx" ON "non_zero"."dynamic_dashboards"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "dynamic_dashboards_workspaceId_name_key" ON "non_zero"."dynamic_dashboards"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "dashboard_participants_dashboardId_idx" ON "non_zero"."dashboard_participants"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_participants_userId_idx" ON "non_zero"."dashboard_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_participants_dashboardId_userId_key" ON "non_zero"."dashboard_participants"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "dashboard_activity_entityType_entityId_createdAt_idx" ON "non_zero"."dashboard_activity"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_createdAt_idx" ON "non_zero"."dashboard_activity"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_actorUserId_idx" ON "non_zero"."dashboard_activity"("actorUserId");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_queryType_idx" ON "non_zero"."dynamic_dashboard_queries"("queryType");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_mapping_dashboardId_idx" ON "non_zero"."dynamic_dashboard_queries_mapping"("dashboardId");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_mapping_queryId_idx" ON "non_zero"."dynamic_dashboard_queries_mapping"("queryId");

