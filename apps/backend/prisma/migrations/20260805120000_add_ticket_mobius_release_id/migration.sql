-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "mobiusReleaseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_workspaceId_mobiusReleaseId_key" ON "public"."tickets"("workspaceId", "mobiusReleaseId");
