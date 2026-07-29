-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ActivityType" ADD VALUE 'RCA_CREATED';
ALTER TYPE "public"."ActivityType" ADD VALUE 'RCA_UPDATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_DUE_DATE_CHANGED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_PRIORITY_CHANGED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_USER_GROUP_CHANGED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_TITLE_CHANGED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_DESCRIPTION_CHANGED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_RCA_CREATED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_RCA_UPDATED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_SUBTICKET_ADDED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_RELATED_TICKET_ADDED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'TICKET_RELATED_TICKET_REMOVED';
