/*
  Warnings:

  - A unique constraint covering the columns `[name,projectId]` on the table `boards` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."boards_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "boards_name_projectId_key" ON "public"."boards"("name", "projectId");
