-- CreateTable
CREATE TABLE "public"."ticket_exports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_exports_workspaceId_requestedBy_createdAt_idx"
  ON "public"."ticket_exports"("workspaceId", "requestedBy", "createdAt" DESC);
