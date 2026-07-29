-- CreateEnum
CREATE TYPE "public"."AttachmentUploadStatus" AS ENUM ('PENDING', 'STARTED', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "public"."message_attachments" ADD COLUMN "uploadStatus" "public"."AttachmentUploadStatus";
