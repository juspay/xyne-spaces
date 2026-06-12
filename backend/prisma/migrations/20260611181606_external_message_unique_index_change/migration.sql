/*
  Warnings:

  - A unique constraint covering the columns `[externalMessageId,channelId]` on the table `emails` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."emails_externalMessageId_key";

-- CreateIndex
CREATE UNIQUE INDEX "emails_externalMessageId_channelId_key" ON "public"."emails"("externalMessageId", "channelId");
