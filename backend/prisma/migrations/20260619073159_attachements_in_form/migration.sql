-- AlterEnum
ALTER TYPE "public"."AttachmentEntityType" ADD VALUE 'FORM_ENTITY_VALUE';

-- AlterEnum
ALTER TYPE "public"."FormFieldType" ADD VALUE 'DOC';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."NotificationType" ADD VALUE 'STAGE_APPROVAL_REQUESTED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'STAGE_APPROVAL_APPROVED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'STAGE_APPROVAL_REJECTED';

-- AlterTable
ALTER TABLE "public"."ticket_stage_requests" ADD COLUMN     "reviewerCommentMessageId" TEXT;
