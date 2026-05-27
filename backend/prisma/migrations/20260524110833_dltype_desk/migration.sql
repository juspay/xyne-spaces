/*
  Warnings:

  - A unique constraint covering the columns `[workspaceId,dlEmail]` on the table `email_channel_preferences` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[workspaceId]` on the table `external_sources` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."DeskType" AS ENUM ('EMAIL', 'DL');

-- AlterTable
ALTER TABLE "public"."email_channel_preferences" ADD COLUMN     "deskType" "public"."DeskType" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "dlEmail" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."external_sources" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "email_channel_preferences_workspaceId_dlEmail_key" ON "public"."email_channel_preferences"("workspaceId", "dlEmail");

-- CreateIndex
CREATE UNIQUE INDEX "external_sources_workspaceId_key" ON "workflow"."external_sources"("workspaceId");
