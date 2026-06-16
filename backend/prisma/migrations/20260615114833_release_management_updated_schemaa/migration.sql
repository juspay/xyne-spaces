/*
  Warnings:

  - You are about to drop the column `status` on the `application_release_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `application_release_tickets` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[applicationReleaseId,ticketId]` on the table `application_release_tickets` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[boardId]` on the table `applications` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[mainReleaseBoardId,name]` on the table `applications` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `releaseId` to the `application_release_tickets` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."VCSProviderType" AS ENUM ('GITHUB', 'BITBUCKET_CLOUD', 'BITBUCKET_SERVER');

-- CreateEnum
CREATE TYPE "public"."ReleaseTrackingMode" AS ENUM ('COMMIT_RANGE', 'VERSION');

-- DropIndex
DROP INDEX "public"."application_release_tickets_status_idx";

-- AlterTable
ALTER TABLE "public"."application_release_tickets" DROP COLUMN "status",
DROP COLUMN "title",
ADD COLUMN     "releaseId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00';

-- AlterTable
ALTER TABLE "public"."applications" ADD COLUMN     "deployedVersion" TEXT,
ADD COLUMN     "envPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mainReleaseBoardId" TEXT,
ADD COLUMN     "migrationPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00';

-- AlterTable
ALTER TABLE "public"."boards" ADD COLUMN     "releaseTrackingMode" "public"."ReleaseTrackingMode",
ADD COLUMN     "vcsProvider" "public"."VCSProviderType";

-- AlterTable
ALTER TABLE "public"."release_change_types" ADD COLUMN     "applicationReleaseId" TEXT,
ADD COLUMN     "commitId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00',
ADD COLUMN     "devTicketXyneId" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "releaseId" TEXT;

-- DropEnum
DROP TYPE "public"."ApplicationReleaseTicketStatus";

-- CreateIndex
CREATE INDEX "application_release_tickets_releaseId_createdAt_id_idx" ON "public"."application_release_tickets"("releaseId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "application_release_tickets_applicationReleaseId_ticketId_key" ON "public"."application_release_tickets"("applicationReleaseId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_boardId_key" ON "public"."applications"("boardId");

-- CreateIndex
CREATE INDEX "applications_mainReleaseBoardId_idx" ON "public"."applications"("mainReleaseBoardId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_mainReleaseBoardId_name_key" ON "public"."applications"("mainReleaseBoardId", "name");

-- CreateIndex
CREATE INDEX "form_entity_values_contextId_idx" ON "public"."form_entity_values"("contextId");

-- CreateIndex
CREATE INDEX "release_change_types_releaseId_idx" ON "public"."release_change_types"("releaseId");

-- CreateIndex
CREATE INDEX "release_change_types_applicationReleaseId_idx" ON "public"."release_change_types"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_change_types_devTicketXyneId_idx" ON "public"."release_change_types"("devTicketXyneId");
