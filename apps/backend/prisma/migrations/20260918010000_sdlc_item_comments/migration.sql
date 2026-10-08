-- CreateTable
CREATE TABLE "public"."sdlc_item_comments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchorQuote" TEXT,
    "anchorSelector" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sdlc_item_comments_entityType_entityId_createdAt_idx" ON "public"."sdlc_item_comments"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "sdlc_item_comments_workspaceId_idx" ON "public"."sdlc_item_comments"("workspaceId");

