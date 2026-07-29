ALTER TABLE "conversations" ADD COLUMN "ticketId" TEXT;

CREATE INDEX "conversations_ticketId_idx" ON "conversations"("ticketId");

