-- CreateTable: ExperimentRun — durable state for Spaces /experiment loops.
CREATE TABLE "experiment_runs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "focus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "currentHypothesis" TEXT,
    "currentSessionId" TEXT,
    "lastEpochEndedAt" TIMESTAMP(3),
    "sandboxNote" TEXT,
    "finalReport" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ExperimentFinding — ledger entries recorded by the experiment runtime.
CREATE TABLE "experiment_findings" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "note" TEXT,
    "proofArtifactPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiment_runs_conversationId_status_idx" ON "experiment_runs"("conversationId", "status");
CREATE INDEX "experiment_findings_experimentId_idx" ON "experiment_findings"("experimentId");

-- AddForeignKey
ALTER TABLE "experiment_findings" ADD CONSTRAINT "experiment_findings_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
