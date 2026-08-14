CREATE TABLE "public"."recording_repair_captures" (
    "captureId" TEXT NOT NULL,
    "callExternalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outages" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL,
    "processingError" TEXT,
    "mergedAt" TIMESTAMP(3),
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_repair_captures_pkey" PRIMARY KEY ("captureId")
);

CREATE INDEX "recording_repair_captures_status_finalizedAt_idx"
ON "public"."recording_repair_captures"("status", "finalizedAt");

CREATE INDEX "recording_repair_captures_callExternalId_idx"
ON "public"."recording_repair_captures"("callExternalId");

CREATE TABLE "public"."recording_repair_call_states" (
    "callExternalId" TEXT NOT NULL,
    "transcriptFinalizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_repair_call_states_pkey" PRIMARY KEY ("callExternalId")
);
