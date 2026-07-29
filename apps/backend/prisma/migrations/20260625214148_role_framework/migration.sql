/*
  Warnings:

  - A unique constraint covering the columns `[ticketId,roleId]` on the table `ticket_assignments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."ticket_assignments" ADD COLUMN     "roleId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "userResponsibility" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_group_mappings" ADD COLUMN     "roleId" TEXT,
ALTER COLUMN "responsibility" DROP NOT NULL,
ALTER COLUMN "responsibility" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_role_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roles_workspaceId_createdAt_id_idx" ON "public"."roles"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "roles_workspaceId_isActive_idx" ON "public"."roles"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "roles_workspaceId_name_key" ON "public"."roles"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "user_role_mappings_userId_idx" ON "public"."user_role_mappings"("userId");

-- CreateIndex
CREATE INDEX "user_role_mappings_roleId_idx" ON "public"."user_role_mappings"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_mappings_userId_roleId_key" ON "public"."user_role_mappings"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignments_ticketId_roleId_key" ON "public"."ticket_assignments"("ticketId", "roleId");

-- CreateIndex
CREATE INDEX "user_group_mappings_roleId_idx" ON "public"."user_group_mappings"("roleId");
