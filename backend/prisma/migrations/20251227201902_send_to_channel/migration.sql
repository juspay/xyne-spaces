-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "parentMessageId" TEXT,

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "childConversationId" TEXT;
