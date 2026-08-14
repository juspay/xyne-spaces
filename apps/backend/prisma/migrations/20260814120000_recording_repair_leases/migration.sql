ALTER TABLE "public"."recording_repair_captures"
ADD COLUMN "outagesHash" TEXT,
ADD COLUMN "leaseId" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "artifactsRefreshed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "recording_repair_captures_leaseExpiresAt_idx"
ON "public"."recording_repair_captures"("leaseExpiresAt");

CREATE INDEX "recording_repair_captures_call_status_artifacts_idx"
ON "public"."recording_repair_captures"("callExternalId", "status", "artifactsRefreshed");
