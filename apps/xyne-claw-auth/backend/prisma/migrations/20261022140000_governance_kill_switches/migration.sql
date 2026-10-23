-- Governance kill switches (PR-12): one row per switch; the epoch moves on every set or clear so
-- every pod can tell with one integer whether its snapshot is current.

-- CreateTable
CREATE TABLE "governance_kill_switches" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "setBy" TEXT NOT NULL,
    "setByUserId" TEXT,
    "triggerKey" TEXT,
    "epoch" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "clearedByUserId" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_kill_switches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governance_kill_switches_clearedAt_expiresAt_idx" ON "governance_kill_switches"("clearedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "governance_kill_switches_orgId_createdAt_idx" ON "governance_kill_switches"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "governance_kill_switches_epoch_idx" ON "governance_kill_switches"("epoch");
