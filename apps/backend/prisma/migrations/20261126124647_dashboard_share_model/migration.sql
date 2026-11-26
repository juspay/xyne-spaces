-- AlterTable
ALTER TABLE "public"."activities" ADD COLUMN     "dashboardId" TEXT;

-- CreateTable
CREATE TABLE "public"."dashboard_shares" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_shares_principalType_principalId_idx" ON "public"."dashboard_shares"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_shares_dashboardId_principalType_principalId_key" ON "public"."dashboard_shares"("dashboardId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "activities_dashboardId_idx" ON "public"."activities"("dashboardId");
