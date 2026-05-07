/*
  Warnings:

  - A unique constraint covering the columns `[workspaceId,xyneId]` on the table `tickets` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."tickets_xyneId_key";

-- CreateIndex
CREATE INDEX "tickets_xyneId_idx" ON "public"."tickets"("xyneId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_workspaceId_xyneId_key" ON "public"."tickets"("workspaceId", "xyneId");
