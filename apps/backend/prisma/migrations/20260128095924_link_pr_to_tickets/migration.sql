-- CreateEnum
CREATE TYPE "PRStatusEvent" AS ENUM ('CREATED', 'UPDATED', 'MERGED', 'DECLINED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'PR';

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "ticketId" TEXT;

-- CreateTable
CREATE TABLE "stage_pr_status_mappings" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "prStatus" "PRStatusEvent" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_pr_status_mappings_pkey" PRIMARY KEY ("id")
);
