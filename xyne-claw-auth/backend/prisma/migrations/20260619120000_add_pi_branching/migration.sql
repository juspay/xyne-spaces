-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "chatMessageId" TEXT;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "agent_runs_chatMessageId_idx" ON "agent_runs"("chatMessageId");
