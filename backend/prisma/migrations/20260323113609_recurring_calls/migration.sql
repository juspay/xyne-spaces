-- CreateEnum
CREATE TYPE "public"."RecurringCallSeriesStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'CALL_UPDATED';

-- CreateTable
CREATE TABLE "public"."recurring_call_series" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "organizerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recurrenceRule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "public"."RecurringCallSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_call_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_call_series_organizerId_idx" ON "public"."recurring_call_series"("organizerId");

-- CreateIndex
CREATE INDEX "recurring_call_series_channelId_idx" ON "public"."recurring_call_series"("channelId");

-- CreateIndex
CREATE INDEX "recurring_call_series_status_idx" ON "public"."recurring_call_series"("status");
