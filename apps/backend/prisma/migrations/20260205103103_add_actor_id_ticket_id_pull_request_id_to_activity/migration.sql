/*
  Warnings:

  - Added the required column `actorId` to the `activities` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "public"."PRStatus" ADD VALUE 'UPDATED';

-- AlterTable
ALTER TABLE "public"."activities" ADD COLUMN     "actorId" TEXT NOT NULL,
ADD COLUMN     "pullRequestId" TEXT,
ADD COLUMN     "ticketId" TEXT;

-- CreateIndex
CREATE INDEX "activities_ticketId_idx" ON "public"."activities"("ticketId");

-- CreateIndex
CREATE INDEX "activities_actorId_idx" ON "public"."activities"("actorId");
