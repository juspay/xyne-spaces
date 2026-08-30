-- A parent -> sub-ticket edge is meaningless more than once, and this index is what
-- rejects the loser of two concurrent linkExisting pushes. See packages/shared/src/tickets/utils.ts.

-- CreateIndex
CREATE UNIQUE INDEX "ticket_sub_ticket_mappings_ticketId_subTicketId_key" ON "public"."ticket_sub_ticket_mappings"("ticketId", "subTicketId");
