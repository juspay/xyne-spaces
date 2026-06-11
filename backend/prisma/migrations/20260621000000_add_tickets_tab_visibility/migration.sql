-- Channel-level admin/owner toggle for the Tickets tab. When OFF, tickets created via the
-- Tickets-tab "Create Ticket" flow are kept out of the channel chat feed; the ticket still
-- lands in the Tickets board. Defaults true to preserve existing behavior. Tickets created by
-- converting an existing message are unaffected.
ALTER TABLE "public"."channels" ADD COLUMN "showTicketsTabTicketsInChat" BOOLEAN DEFAULT true;

-- Per-conversation flag decided at ticket creation. When true, the conversation is omitted from
-- the channel chat feed. Set for a Tickets-tab "Create Ticket" ticket created while the channel's
-- showTicketsTabTicketsInChat setting was OFF. The ticket itself is unaffected — it stays in the
-- Tickets board and its thread is reachable from the ticket detail view.
ALTER TABLE "public"."conversations" ADD COLUMN "doNotPostToChannel" BOOLEAN DEFAULT false;

-- Speeds up channel-feed queries that exclude hidden ticket conversations.
CREATE INDEX "conversations_channelId_doNotPostToChannel_createdAt_conver_idx" ON "public"."conversations"("channelId", "doNotPostToChannel", "createdAt" DESC, "conversationId" ASC);
