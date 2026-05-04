-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "scheduledJobId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_job_runs_scheduledJobId_idx" ON "scheduled_job_runs"("scheduledJobId");

-- CreateIndex
CREATE INDEX "scheduled_jobs_agentSlug_idx" ON "scheduled_jobs"("agentSlug");

-- AddForeignKey
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduled_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
