-- CreateTable
CREATE TABLE "public"."view_access" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "view_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "view_access_viewId_idx" ON "public"."view_access"("viewId");

-- CreateIndex
CREATE INDEX "view_access_entityType_entityId_idx" ON "public"."view_access"("entityType", "entityId");
