-- CreateEnum
CREATE TYPE "public"."QueryVisualizationType" AS ENUM ('KPI', 'BAR_CHART', 'PIE_CHART', 'DONUT_CHART', 'LINE_CHART', 'FUNNEL', 'HEATMAP', 'DATA_TABLE');

-- AlterTable
ALTER TABLE "public"."dashboard_queries_mapping" ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."queries" ADD COLUMN     "targetEntity" TEXT,
ADD COLUMN     "visualType" "public"."QueryVisualizationType",
ALTER COLUMN "entityType" DROP NOT NULL;
