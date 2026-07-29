/*
  Warnings:

  - The values [USER] on the enum `ChannelScopeType` will be removed. If these variants are still used in the database, this will fail.
  - The values [OPENED,PROCESSING,COULD_NOT_RESOLVE,VALIDATED] on the enum `TicketStatus` will be removed. If these variants are still used in the database, this will fail.
  - The primary key for the `channels` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `channelId` on the `channels` table. All the data in the column will be lost.
  - You are about to drop the column `orgName` on the `channels` table. All the data in the column will be lost.
  - You are about to drop the column `scopeId` on the `channels` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `channels` table. All the data in the column will be lost.
  - You are about to drop the column `topicTags` on the `channels` table. All the data in the column will be lost.
  - The primary key for the `message_attachments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `attachmentId` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `fileName` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `fileSize` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `fileUrl` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `messageId` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `mimeType` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `uploadedBy` on the `message_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `attachments` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `environment` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `externalSourceId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `externalTicketId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `humanReadableId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `owner` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `reportedBy` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `scope` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `slackChannelId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `slackThreadId` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `validationReason` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `workflowType` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `skills` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `userGroupId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `user_group_memberships` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[xyneId]` on the table `tickets` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `channels` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `name` to the `channels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `channels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdBy` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityId` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityType` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `message_attachments` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `mimetype` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalFilename` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storageProvider` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `uploadedByUserId` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `url` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `boardId` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stageName` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `xyneId` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdBy` on table `tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedBy` on table `tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `conversationId` on table `tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userGroupId` on table `tickets` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "WorkflowCategory" AS ENUM ('USER_ONBOARDING', 'BUG_WORKFLOW', 'BUG_WORKFLOW_EVAL', 'BUG_WORKFLOW_EVAL_INNER_STEPS', 'BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL', 'FEATURE_IMPLEMENTATION', 'FEATURE_PLANNING', 'XYNE_SPACES_FEATURE_IMPLEMENTATION', 'FIDO_SERVER_WORKFLOW', 'CONNECTOR_MIGRATION', 'CODER_WORKFLOW', 'QUERY_WORKFLOW', 'QUERY', 'ISSUE', 'REQUIREMENT_NEW', 'REQUIREMENT_ENHANCEMENT', 'FULL_PG_INTEGRATION', 'INVESTIGATION_WORKFLOW', 'GENIUS_INVESTIGATION_WORKFLOW', 'STAGE_APPROVAL_WORKFLOW');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('MERCHANT', 'GATEWAY');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TITLE', 'DESCRIPTION', 'STATUS', 'ASSIGNED_TO', 'PRIORITY', 'ETA', 'METADATA', 'CLOSED_AT', 'CLOSED_BY', 'REFERENCE_TICKET', 'STAGE_NAME', 'TAGS', 'ENTITY');

-- CreateEnum
CREATE TYPE "AttachmentEntityType" AS ENUM ('TICKET', 'CHAT');

-- AlterEnum
-- AlterEnum (Rename USER to DM)
BEGIN;
-- Create new enum without 'USER', using CASE to map 'USER' → 'DM'
CREATE TYPE "ChannelScopeType_new" AS ENUM ('DEFAULT', 'DM', 'TICKET', 'DOCUMENT', 'GROUP_DM');
ALTER TABLE "channels" ALTER COLUMN "scopeType" TYPE "ChannelScopeType_new"
  USING (CASE
    WHEN "scopeType"::text = 'USER' THEN 'DM'::"ChannelScopeType_new"
    ELSE "scopeType"::text::"ChannelScopeType_new"
  END);
ALTER TYPE "ChannelScopeType" RENAME TO "ChannelScopeType_old";
ALTER TYPE "ChannelScopeType_new" RENAME TO "ChannelScopeType";
DROP TYPE "ChannelScopeType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TicketStatus_new" AS ENUM ('NEW', 'TO_BE_PICKED_UP', 'IN_PROGRESS', 'ON_HOLD_EXTERNAL', 'ON_HOLD_INTERNAL', 'COMPLETED', 'REJECTED', 'DROPPED', 'BACKLOG', 'RESOLVED');
ALTER TABLE "tickets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tickets" ALTER COLUMN "status" TYPE "TicketStatus_new" USING ("status"::text::"TicketStatus_new");
ALTER TYPE "TicketStatus" RENAME TO "TicketStatus_old";
ALTER TYPE "TicketStatus_new" RENAME TO "TicketStatus";
DROP TYPE "TicketStatus_old";
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'NEW';
COMMIT;

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignedTo_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_updatedBy_fkey";

-- DropForeignKey
ALTER TABLE "user_group_memberships" DROP CONSTRAINT "user_group_memberships_userGroupId_fkey";

-- DropForeignKey
ALTER TABLE "user_group_memberships" DROP CONSTRAINT "user_group_memberships_userId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_userGroupId_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_ticketId_fkey";

-- DropIndex
DROP INDEX "channels_orgName_idx";

-- DropIndex
DROP INDEX "channels_scopeType_scopeId_idx";

-- DropIndex
DROP INDEX "channels_title_orgName_key";

-- DropIndex
DROP INDEX "message_attachments_messageId_idx";

-- DropIndex
DROP INDEX "tickets_externalSourceId_externalTicketId_idx";

-- DropIndex
DROP INDEX "tickets_humanReadableId_key";

-- DropIndex
DROP INDEX "tickets_title_key";

-- DropIndex
DROP INDEX "tickets_userGroupId_status_idx";

-- AlterTable
ALTER TABLE "channels" DROP CONSTRAINT "channels_pkey",
RENAME COLUMN "channelId" TO "id",
DROP COLUMN "orgName",
DROP COLUMN "scopeId",
DROP COLUMN "title",
DROP COLUMN "topicTags",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "projectId" TEXT NOT NULL,
ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_pkey",
DROP COLUMN "attachmentId",
DROP COLUMN "fileName",
DROP COLUMN "fileSize",
DROP COLUMN "fileUrl",
DROP COLUMN "messageId",
DROP COLUMN "mimeType",
DROP COLUMN "uploadedBy",
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "entityId" TEXT NOT NULL,
ADD COLUMN     "entityType" "AttachmentEntityType" NOT NULL,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "mimetype" TEXT NOT NULL,
ADD COLUMN     "originalFilename" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL,
ADD COLUMN     "storageProvider" TEXT NOT NULL,
ADD COLUMN     "uploadedByUserId" TEXT NOT NULL,
ADD COLUMN     "url" TEXT NOT NULL,
ADD CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "attachments",
DROP COLUMN "entityId",
DROP COLUMN "environment",
DROP COLUMN "externalSourceId",
DROP COLUMN "externalTicketId",
DROP COLUMN "humanReadableId",
DROP COLUMN "owner",
DROP COLUMN "reportedBy",
DROP COLUMN "scope",
DROP COLUMN "slackChannelId",
DROP COLUMN "slackThreadId",
DROP COLUMN "validationReason",
DROP COLUMN "workflowType",
ADD COLUMN     "boardId" TEXT NOT NULL,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "priority" "TicketPriority" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "projectId" TEXT NOT NULL,
ADD COLUMN     "referenceTicket" TEXT[],
ADD COLUMN     "stageName" TEXT NOT NULL,
ADD COLUMN     "xyneId" TEXT NOT NULL,
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'NEW',
ALTER COLUMN "createdBy" SET NOT NULL,
ALTER COLUMN "updatedBy" SET NOT NULL,
ALTER COLUMN "conversationId" SET NOT NULL,
ALTER COLUMN "userGroupId" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "skills",
DROP COLUMN "userGroupId";

-- DropTable
DROP TABLE "user_group_memberships";

-- DropEnum
DROP TYPE "TicketCategory";

-- CreateTable
CREATE TABLE "sub_tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mappedTicketId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stageProgression" TEXT,
    "assignedTo" TEXT,

    CONSTRAINT "sub_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_sub_ticket_mappings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "subTicketId" TEXT NOT NULL,

    CONSTRAINT "ticket_sub_ticket_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_activities" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityType" "ActivityType" NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "ticket_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_entity_mappings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityName" TEXT NOT NULL,

    CONSTRAINT "ticket_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_group_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eta" INTEGER NOT NULL,
    "boardId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sub_tickets_title_idx" ON "sub_tickets"("title");

-- CreateIndex
CREATE INDEX "sub_tickets_mappedTicketId_idx" ON "sub_tickets"("mappedTicketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_ticketId_idx" ON "ticket_sub_ticket_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_subTicketId_idx" ON "ticket_sub_ticket_mappings"("subTicketId");

-- CreateIndex
CREATE INDEX "ticket_activities_ticketId_idx" ON "ticket_activities"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_entity_mappings_ticketId_idx" ON "ticket_entity_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_tags_ticketId_idx" ON "ticket_tags"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_mappings_userId_userGroupId_key" ON "user_group_mappings"("userId", "userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "boards_name_key" ON "boards"("name");

-- CreateIndex
CREATE INDEX "boards_projectId_idx" ON "boards"("projectId");

-- CreateIndex
CREATE INDEX "stages_boardId_idx" ON "stages"("boardId");

-- CreateIndex
CREATE INDEX "message_attachments_entityType_idx" ON "message_attachments"("entityType");

-- CreateIndex
CREATE INDEX "message_attachments_conversationId_idx" ON "message_attachments"("conversationId");

-- CreateIndex
CREATE INDEX "message_attachments_entityId_idx" ON "message_attachments"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_xyneId_key" ON "tickets"("xyneId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");

-- CreateIndex
CREATE INDEX "tickets_updatedAt_idx" ON "tickets"("updatedAt");

-- CreateIndex
CREATE INDEX "tickets_eta_idx" ON "tickets"("eta");

-- CreateIndex
CREATE INDEX "tickets_boardId_idx" ON "tickets"("boardId");

-- CreateIndex
CREATE INDEX "tickets_projectId_idx" ON "tickets"("projectId");

-- CreateIndex
CREATE INDEX "tickets_userGroupId_idx" ON "tickets"("userGroupId");
