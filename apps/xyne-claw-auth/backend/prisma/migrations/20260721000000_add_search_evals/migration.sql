-- CreateTable
CREATE TABLE "search_eval_sheets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orgId" TEXT NOT NULL,
    "permissionMode" TEXT NOT NULL DEFAULT 'with',
    "asOfTimestamp" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_queries" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "goldAnswer" TEXT,
    "goldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_runs" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "queryType" TEXT[],
    "rankProfile" TEXT,
    "rankProfileInputs" JSONB,
    "permissionMode" TEXT NOT NULL,
    "asOfTimestamp" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdBy" TEXT,
    "orgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "queriesScored" INTEGER,
    "top1Count" INTEGER,
    "top1Pct" DOUBLE PRECISION,
    "top3Count" INTEGER,
    "top3Pct" DOUBLE PRECISION,
    "top10Count" INTEGER,
    "top10Pct" DOUBLE PRECISION,
    "mrr" DOUBLE PRECISION,

    CONSTRAINT "search_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "hit" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER,
    "topResults" JSONB NOT NULL,
    "debug" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_eval_sheets_orgId_idx" ON "search_eval_sheets"("orgId");

-- CreateIndex
CREATE INDEX "search_eval_queries_sheetId_idx" ON "search_eval_queries"("sheetId");

-- CreateIndex
CREATE INDEX "search_eval_runs_sheetId_startedAt_idx" ON "search_eval_runs"("sheetId", "startedAt");

-- CreateIndex
CREATE INDEX "search_eval_runs_orgId_idx" ON "search_eval_runs"("orgId");

-- CreateIndex
CREATE INDEX "search_eval_results_runId_idx" ON "search_eval_results"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "search_eval_results_runId_queryId_key" ON "search_eval_results"("runId", "queryId");

-- AddForeignKey
ALTER TABLE "search_eval_queries" ADD CONSTRAINT "search_eval_queries_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "search_eval_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_runs" ADD CONSTRAINT "search_eval_runs_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "search_eval_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_results" ADD CONSTRAINT "search_eval_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "search_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_results" ADD CONSTRAINT "search_eval_results_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "search_eval_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

