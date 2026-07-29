-- CreateEnum
CREATE TYPE "ApplicationReleaseTicketStatus" AS ENUM ('NOT_TESTED', 'TESTING', 'PASSED', 'FAILED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ReleaseEventType" AS ENUM ('RELEASE', 'TICKET', 'SUBTICKET', 'TESTING', 'SYSTEM', 'CANVAS');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "channelId" TEXT,
    "regex" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "deployedCommit" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "ownerTeam" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_release_tickets" (
    "id" TEXT NOT NULL,
    "applicationReleaseId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ApplicationReleaseTicketStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "testedBy" TEXT,
    "testedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_release_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_events" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "applicationReleaseId" TEXT,
    "eventType" "ReleaseEventType" NOT NULL,
    "eventName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_changes" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "applicationReleaseId" TEXT,
    "applicationId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_change_types" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,

    CONSTRAINT "release_change_types_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "applications_projectId_idx" ON "applications"("projectId");

-- CreateIndex
CREATE INDEX "applications_channelId_idx" ON "applications"("channelId");

-- CreateIndex
CREATE INDEX "applications_boardId_idx" ON "applications"("boardId");

-- CreateIndex
CREATE INDEX "application_release_tickets_applicationReleaseId_idx" ON "application_release_tickets"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "application_release_tickets_ticketId_idx" ON "application_release_tickets"("ticketId");

-- CreateIndex
CREATE INDEX "application_release_tickets_status_idx" ON "application_release_tickets"("status");

-- CreateIndex
CREATE INDEX "release_events_releaseId_idx" ON "release_events"("releaseId");

-- CreateIndex
CREATE INDEX "release_events_applicationReleaseId_idx" ON "release_events"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_events_channelId_conversationId_idx" ON "release_events"("channelId", "conversationId");

-- CreateIndex
CREATE INDEX "release_events_eventType_idx" ON "release_events"("eventType");

-- CreateIndex
CREATE INDEX "release_events_createdAt_idx" ON "release_events"("createdAt");

-- CreateIndex
CREATE INDEX "release_changes_releaseId_idx" ON "release_changes"("releaseId");

-- CreateIndex
CREATE INDEX "release_changes_applicationReleaseId_idx" ON "release_changes"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_changes_applicationId_idx" ON "release_changes"("applicationId");

-- CreateIndex
CREATE INDEX "release_change_types_id_idx" ON "release_change_types"("id");

-- CreateIndex
CREATE INDEX "release_change_types_applicationId_idx" ON "release_change_types"("applicationId");

-- CreateIndex
CREATE INDEX "release_change_types_changeType_idx" ON "release_change_types"("changeType");

-- ============================================
-- Lookup values for dynamic enums
-- ============================================

-- CreateEnum
CREATE TYPE "LookupValueType" AS ENUM ('TICKET_TYPE');

-- CreateTable
CREATE TABLE "lookup_values" (
    "id" TEXT NOT NULL,
    "type" "LookupValueType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_type_value_key" ON "lookup_values"("type", "value");

-- CreateIndex
CREATE INDEX "lookup_values_type_idx" ON "lookup_values"("type");


-- Migration: Add boardType column to boards table and extend Form enums
-- Description: Adds BoardType enum and column to support DEFAULT and RELEASE board types,
-- extends FormContextType and FormEntityType enums for release management

-- ============================================
-- BoardType additions
-- ============================================

-- Step 1: Create the BoardType enum
CREATE TYPE "BoardType" AS ENUM ('DEFAULT', 'RELEASE');

-- Step 2: Add boardType column with DEFAULT as default value for existing rows
ALTER TABLE "boards" ADD COLUMN "boardType" "BoardType" NOT NULL DEFAULT 'DEFAULT';


-- Step 3: Add new value to FormContextType enum
ALTER TYPE "FormContextType" ADD VALUE IF NOT EXISTS 'RELEASE_CHANGE';

-- Step 4: Add new values to FormEntityType enum
ALTER TYPE "FormEntityType" ADD VALUE IF NOT EXISTS 'SUB_TICKET';
ALTER TYPE "FormEntityType" ADD VALUE IF NOT EXISTS 'RELEASE_MIGRATION_FORM';
ALTER TYPE "FormEntityType" ADD VALUE IF NOT EXISTS 'RELEASE_ENV_FORM';

-- ============================================
-- Ticket type additions
-- ============================================

-- Step 5: Add ticketType column to tickets table
ALTER TABLE "tickets" ADD COLUMN "ticketType" TEXT DEFAULT 'Fix';
-- Step 6: Create index for ticket type lookups
CREATE INDEX "tickets_ticketType_idx" ON "tickets"("ticketType");

