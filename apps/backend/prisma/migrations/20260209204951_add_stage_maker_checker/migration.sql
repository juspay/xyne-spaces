/*
  Warnings:

  - A unique constraint covering the columns `[entityId,entityType,fieldId,contextId]` on the table `form_entity_values` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."TicketStageRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ActivityType" ADD VALUE 'STAGE_CHANGE_REQUEST';
ALTER TYPE "public"."ActivityType" ADD VALUE 'STAGE_CHANGE_APPROVED';
ALTER TYPE "public"."ActivityType" ADD VALUE 'STAGE_CHANGE_REJECTED';

-- AlterEnum
ALTER TYPE "public"."FormContextType" ADD VALUE 'STAGE';

-- DropIndex
DROP INDEX "public"."form_entity_values_entityId_entityType_fieldId_key";

-- AlterTable
ALTER TABLE "public"."form_entity_values" ADD COLUMN     "contextId" TEXT;

-- CreateTable
CREATE TABLE "public"."stage_approvers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "stage_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_stage_requests" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "formId" TEXT,
    "status" "public"."TicketStageRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_stage_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stage_approvers_stageId_userId_key" ON "public"."stage_approvers"("stageId", "userId");

-- CreateIndex
CREATE INDEX "stage_approvers_stageId_idx" ON "public"."stage_approvers"("stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_ticketId_idx" ON "public"."ticket_stage_requests"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_stageId_idx" ON "public"."ticket_stage_requests"("stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_formId_idx" ON "public"."ticket_stage_requests"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_stage_requests_ticketId_stageId_key" ON "public"."ticket_stage_requests"("ticketId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "form_entity_values_entityId_entityType_fieldId_contextId_key" ON "public"."form_entity_values"("entityId", "entityType", "fieldId", "contextId");
