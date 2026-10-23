-- AlterTable
ALTER TABLE "public"."call_participants" ADD COLUMN     "ringNotification" TEXT;

-- AlterTable
ALTER TABLE "public"."recurring_call_participants" ADD COLUMN     "ringNotification" TEXT;
