-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN "callUpdatesChannel" TEXT;

-- AlterTable
ALTER TABLE "public"."recurring_call_series" ADD COLUMN "callUpdatesChannel" TEXT;
