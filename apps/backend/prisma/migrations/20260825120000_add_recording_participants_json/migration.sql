-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN     "recordingParticipants" TEXT NOT NULL DEFAULT '[]';
