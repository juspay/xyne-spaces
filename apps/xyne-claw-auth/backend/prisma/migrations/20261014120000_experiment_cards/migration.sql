ALTER TABLE "experiment_runs" ADD COLUMN "statusMessageId" TEXT;

CREATE TABLE "experiment_epochs" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "hypothesis" TEXT,
    "plan" JSONB,
    "previewUrl" TEXT,
    "codeUrl" TEXT,
    "terminalUrl" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summary" TEXT,
    "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needsYou" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_epochs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "experiment_epochs_sessionId_key" ON "experiment_epochs"("sessionId");
CREATE INDEX "experiment_epochs_experimentId_epoch_idx" ON "experiment_epochs"("experimentId", "epoch");

ALTER TABLE "experiment_epochs" ADD CONSTRAINT "experiment_epochs_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
