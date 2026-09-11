/*
  Warnings:

  - Made the column `workspaceId` on table `external_sources` required. This step will fail if there are existing NULL values in that column.
*/

-- AlterTable
ALTER TABLE "workflow"."external_sources" ALTER COLUMN "workspaceId" SET NOT NULL;
