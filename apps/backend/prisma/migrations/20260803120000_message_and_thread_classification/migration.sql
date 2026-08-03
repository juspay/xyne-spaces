-- Message and thread classification.
--
-- Stored as columns on the rows they describe rather than in join tables:
--   * conversations.threadType — the channel list already syncs this row, so the tag
--     arrives with no extra query.
--   * messages.messageActs     — inherits MessagesACL, so there is no second ACL that can
--     drift looser than the read one.
-- Mirrors how tickets carry classification (Ticket.aiCategory / aiPriority).

-- AlterTable
ALTER TABLE "public"."conversations" ADD COLUMN "threadType" TEXT;

-- AlterTable
-- Stringified JSON array of message acts: '["DECISION","QUESTION"]'
ALTER TABLE "public"."messages" ADD COLUMN "messageActs" TEXT;
