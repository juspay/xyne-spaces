-- AlterEnum
ALTER TYPE "public"."ActivityType" ADD VALUE 'IS_ARCHIVED';

-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tickets_isArchived_idx" ON "public"."tickets"("isArchived");

-- CreateIndex
CREATE INDEX "tickets_isArchived_projectId_idx" ON "public"."tickets"("isArchived", "projectId");

-- CreateIndex
CREATE INDEX "tickets_isArchived_ticketType_idx" ON "public"."tickets"("isArchived", "ticketType");
