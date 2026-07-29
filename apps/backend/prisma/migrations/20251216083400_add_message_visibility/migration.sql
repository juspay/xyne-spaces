-- AlterTable
ALTER TABLE "messages" ADD COLUMN "visibleTo" TEXT DEFAULT NULL;

-- CreateIndex
CREATE INDEX "messages_visibleTo_idx" ON "messages"("visibleTo");

-- CreateIndex
CREATE INDEX "messages_conversationId_visibleTo_idx" ON "messages"("conversationId", "visibleTo");
