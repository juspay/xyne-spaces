-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN     "recordingParticipants" TEXT[] DEFAULT ARRAY[]::TEXT[];
