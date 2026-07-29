-- AlterTable
ALTER TABLE "public"."user_profiles" ADD COLUMN     "hasVoiceSignature" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voiceSignature" BYTEA;
