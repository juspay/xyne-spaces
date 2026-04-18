-- AlterTable: add soft-delete flag to message_attachments
ALTER TABLE "public"."message_attachments" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
