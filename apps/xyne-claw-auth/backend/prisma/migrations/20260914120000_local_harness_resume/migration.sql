-- AlterTable
ALTER TABLE "local_harness_runs" ADD COLUMN     "cliSessionId" TEXT,
ADD COLUMN     "pendingAction" JSONB,
ADD COLUMN     "pendingActionId" TEXT;

-- CreateIndex
CREATE INDEX "local_harness_runs_pendingActionId_idx" ON "local_harness_runs"("pendingActionId");
