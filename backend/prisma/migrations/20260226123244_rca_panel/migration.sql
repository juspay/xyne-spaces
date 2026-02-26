/*
  Warnings:

  - You are about to drop the column `callOrigin` on the `calls` table. All the data in the column will be lost.
  - You are about to drop the column `callId` on the `conversations` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."RCAStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."COEStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."SEVERITY" AS ENUM ('SEV_1', 'SEV_2', 'SEV_3');

-- CreateEnum
CREATE TYPE "public"."AttributionConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
ALTER TYPE "public"."AttachmentEntityType" ADD VALUE 'IMPACT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE';
ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE_RELIABILITY_CHANGE';
ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE_RELIABILITY_CAPACITY';
ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE_RELIABILITY_FAULT';
ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE_PERF';
ALTER TYPE "public"."LookupType" ADD VALUE 'COE_ACTION_TYPE_UIUX';
ALTER TYPE "public"."LookupType" ADD VALUE 'IMPACT_TYPE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_TYPE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_CATEGORY_TYPE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_ISSUE_TYPE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_ISSUE_CATEGORY_CAPACITY';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_ISSUE_CATEGORY_CHANGE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_ISSUE_CATEGORY_FAULT';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_RESOLUTION_CAPACITY';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_RESOLUTION_CHANGE';
ALTER TYPE "public"."LookupType" ADD VALUE 'BUG_RESOLUTION_FAULT';
ALTER TYPE "public"."LookupType" ADD VALUE 'QUICK_FIX_OPTION';

-- DropIndex
DROP INDEX "public"."conversations_callId_idx";

-- DropIndex
DROP INDEX "public"."conversations_conversationId_callId_idx";

-- AlterTable
ALTER TABLE "public"."calls" DROP COLUMN "callOrigin";

-- AlterTable
ALTER TABLE "public"."conversations" DROP COLUMN "callId";

-- DropEnum
DROP TYPE "public"."CallOrigin";

-- CreateTable
CREATE TABLE "public"."rcas" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "summary" TEXT,
    "rootCause" TEXT,
    "severity" "public"."SEVERITY" NOT NULL,
    "status" "public"."RCAStatus" NOT NULL DEFAULT 'DRAFT',
    "bugTypeId" TEXT NOT NULL,
    "categoryTypeId" TEXT NOT NULL,
    "issueCategoryId" TEXT,
    "issueStartAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rcas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."impacts" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "rcaId" TEXT,
    "impactTypeId" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."coes" (
    "id" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "actionTypeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "public"."COEStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "coes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."release_attributions" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "releaseApplicationId" TEXT,
    "rootCauseTicketId" TEXT,
    "confidence" "public"."AttributionConfidence" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rcas_ticketId_idx" ON "public"."rcas"("ticketId");

-- CreateIndex
CREATE INDEX "rcas_ownerId_idx" ON "public"."rcas"("ownerId");

-- CreateIndex
CREATE INDEX "rcas_status_idx" ON "public"."rcas"("status");

-- CreateIndex
CREATE INDEX "impacts_ticketId_idx" ON "public"."impacts"("ticketId");

-- CreateIndex
CREATE INDEX "impacts_rcaId_idx" ON "public"."impacts"("rcaId");

-- CreateIndex
CREATE INDEX "impacts_impactTypeId_idx" ON "public"."impacts"("impactTypeId");

-- CreateIndex
CREATE INDEX "coes_rcaId_idx" ON "public"."coes"("rcaId");

-- CreateIndex
CREATE INDEX "coes_ownerId_idx" ON "public"."coes"("ownerId");

-- CreateIndex
CREATE INDEX "coes_status_idx" ON "public"."coes"("status");

-- CreateIndex
CREATE INDEX "coes_actionTypeId_idx" ON "public"."coes"("actionTypeId");

-- CreateIndex
CREATE INDEX "release_attributions_ticketId_idx" ON "public"."release_attributions"("ticketId");

-- CreateIndex
CREATE INDEX "release_attributions_releaseId_idx" ON "public"."release_attributions"("releaseId");

-- CreateIndex
CREATE INDEX "release_attributions_releaseApplicationId_idx" ON "public"."release_attributions"("releaseApplicationId");

-- CreateIndex
CREATE INDEX "release_attributions_rootCauseTicketId_idx" ON "public"."release_attributions"("rootCauseTicketId");
