/*
  Warnings:

  - You are about to drop the column `userId` on the `org_members` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `org_members` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,workspaceId]` on the table `projects` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,workspaceId]` on the table `projects` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,workspaceId]` on the table `tools` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[workspaceId,name]` on the table `user_groups` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerUserId,workspaceId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email,workspaceId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `workspaceId` to the `agents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `boards` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `channels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `formId` to the `form_entity_values` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `forms` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `message_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `models` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `org_members` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `sub_tickets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `tools` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `user_groups` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgMemberId` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceId` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."ProjectType" AS ENUM ('DEFAULT', 'DM');

-- CreateEnum
CREATE TYPE "public"."Status" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

-- DropIndex
DROP INDEX "public"."channels_visibility_id_idx";

-- DropIndex
DROP INDEX "public"."org_members_orgId_userId_key";

-- DropIndex
DROP INDEX "public"."org_members_userId_idx";

-- DropIndex
DROP INDEX "public"."projects_code_key";

-- DropIndex
DROP INDEX "public"."projects_name_key";

-- DropIndex
DROP INDEX "public"."tools_name_key";

-- DropIndex
DROP INDEX "public"."user_groups_alias_key";

-- DropIndex
DROP INDEX "public"."user_groups_name_key";

-- DropIndex
DROP INDEX "public"."users_email_key";

-- DropIndex
DROP INDEX "public"."users_providerUserId_key";

-- AlterTable
ALTER TABLE "public"."agents" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."boards" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."channels" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."form_entity_values" ADD COLUMN     "formId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."forms" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."message_attachments" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."models" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."org_members" DROP COLUMN "userId",
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "leftAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "status" "public"."Status" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "type" "public"."ProjectType" NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."sub_tickets" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."tools" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_groups" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "leftAt" TIMESTAMP(3),
ADD COLUMN     "orgMemberId" TEXT NOT NULL,
ADD COLUMN     "role" "public"."WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."workspace_organizations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "public"."WorkspaceRole" NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workspaces" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" "public"."Status" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "workspaceId" TEXT,
    "email" TEXT NOT NULL,
    "role" "public"."WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "invitationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_organizations_orgId_idx" ON "public"."workspace_organizations"("orgId");

-- CreateIndex
CREATE INDEX "workspace_organizations_workspaceId_idx" ON "public"."workspace_organizations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_organizations_orgId_workspaceId_key" ON "public"."workspace_organizations"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "workspaces_orgId_idx" ON "public"."workspaces"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_orgId_name_key" ON "public"."workspaces"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_invitationId_key" ON "public"."invitations"("invitationId");

-- CreateIndex
CREATE INDEX "invitations_orgId_idx" ON "public"."invitations"("orgId");

-- CreateIndex
CREATE INDEX "invitations_workspaceId_idx" ON "public"."invitations"("workspaceId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "public"."invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_invitationId_idx" ON "public"."invitations"("invitationId");

-- CreateIndex
CREATE INDEX "channels_workspaceId_visibility_id_idx" ON "public"."channels"("workspaceId", "visibility", "id");

-- CreateIndex
CREATE INDEX "models_workspaceId_idx" ON "public"."models"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_email_key" ON "public"."org_members"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_workspaceId_key" ON "public"."projects"("name", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_workspaceId_key" ON "public"."projects"("code", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_name_workspaceId_key" ON "public"."tools"("name", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_workspaceId_name_key" ON "public"."user_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_providerUserId_idx" ON "public"."users"("providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "users_providerUserId_workspaceId_key" ON "public"."users"("providerUserId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_workspaceId_key" ON "public"."users"("email", "workspaceId");

-- Performance indices: eliminate table scans and TEMP B-TREEs in zero-cache queries
CREATE INDEX "organizations_status_name_idx" ON "public"."organizations"("status", "name");
CREATE INDEX "org_members_orgId_joinedAt_idx" ON "public"."org_members"("orgId", "joinedAt");
CREATE INDEX "workspace_organizations_workspaceId_createdAt_id_idx" ON "public"."workspace_organizations"("workspaceId", "createdAt" DESC, "id");
CREATE INDEX "invitations_createdAt_id_idx" ON "public"."invitations"("createdAt" DESC, "id");
CREATE INDEX "channel_participants_userId_role_id_idx" ON "public"."channel_participants"("userId", "role", "id");
CREATE INDEX "email_signatures_userId_name_id_idx" ON "public"."email_signatures"("userId", "name", "id");
