-- CreateEnum — RecordingType stays in "public": it is also used by calls.recordingType.
-- call_recordings (in "non_zero") references it cross-schema.
CREATE TYPE "public"."RecordingType" AS ENUM ('AUDIO_ONLY', 'AUDIO_SCREEN', 'AUDIO_VIDEO');

-- CreateEnum — RecordingStatus is only used by call_recordings, so it lives in "non_zero".
CREATE TYPE "non_zero"."RecordingStatus" AS ENUM (
  'RECORDING_ACTIVE',
  'RECORDING_STOPPED',
  'PROCESSING_RECORDING',
  'RECORDING_UPLOADED',
  'RECORDING_FAILED',
  'RECORDING_UPLOAD_FAILED',
  'PROCESSING_FAILED',
  'RECORDING_EXPIRED',
  'RECORDING_DELETED'
);

-- CreateTable — Prisma model: CallRecording (@@map "call_recordings", @@schema "non_zero").
-- Server-write-only table, not synced via Zero (Zero mirrors "public"), so it lives in "non_zero".
-- Foreign keys reference "public".calls / "public".users cross-schema — both already exist here.
CREATE TABLE "non_zero"."call_recordings" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "egressId" TEXT,
    "startedBy" TEXT NOT NULL,
    "name" TEXT,
    "recordingType" "public"."RecordingType" NOT NULL,
    "status" "non_zero"."RecordingStatus" NOT NULL,
    "storagePath" TEXT,
    "segmentPrefix" TEXT,
    "messageId" TEXT,
    -- No DEFAULT on startedAt/createdAt — values are passed from application code (team convention).
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id"),
    -- Cascade delete recordings when the parent call is deleted.
    CONSTRAINT "call_recordings_callId_fkey" FOREIGN KEY ("callId") REFERENCES "public"."calls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- startedBy is always known at creation (set even if the recording later fails), so it is NOT NULL.
    -- Cascade delete recordings when the starter user is hard-deleted (users are hard-deleted in this codebase).
    CONSTRAINT "call_recordings_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "call_recordings_egressId_key" ON "non_zero"."call_recordings"("egressId");

-- CreateIndex
CREATE INDEX "call_recordings_callId_idx" ON "non_zero"."call_recordings"("callId");

-- Single-active concurrency lock (C3). Prisma cannot express a partial unique
-- index, so it is created here by hand. At most one ACTIVE recording per call;
-- the insert of an ACTIVE row IS the lock. STOPPED/terminal rows free it.
CREATE UNIQUE INDEX "call_recordings_one_active" ON "non_zero"."call_recordings"("callId") WHERE "status" = 'RECORDING_ACTIVE';
