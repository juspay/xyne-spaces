-- CreateEnum
CREATE TYPE "workflow"."SessionRecordingProcessStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "workflow"."session_recording_files" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "workflow"."SessionRecordingProcessStatus" NOT NULL DEFAULT 'PENDING',
    "lastProcessedTurn" INTEGER,

    CONSTRAINT "session_recording_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_recording_files_sessionId_key" ON "workflow"."session_recording_files"("sessionId");

-- CreateIndex
CREATE INDEX "session_recording_files_status_idx" ON "workflow"."session_recording_files"("status");

-- CreateIndex
CREATE INDEX "session_recording_files_sessionId_idx" ON "workflow"."session_recording_files"("sessionId");
