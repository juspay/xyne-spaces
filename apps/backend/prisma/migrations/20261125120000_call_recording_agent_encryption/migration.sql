-- Recordings of end-to-end encrypted calls are made by the transcription agent and
-- stored encrypted. Both columns are nullable: existing rows are egress recordings,
-- stored unencrypted.
-- AlterTable
ALTER TABLE "non_zero"."call_recordings" ADD COLUMN     "encryption" JSONB,
ADD COLUMN     "recorder" TEXT;
