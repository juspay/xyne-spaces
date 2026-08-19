-- Backstop for subTicket.linkExisting.
--
-- The mutator refuses a duplicate link by reading the existing mappings first, but a
-- read-then-write cannot stop two concurrent pushes (two tabs, two users) from both
-- observing "not linked yet" and both inserting. A parent -> sub-ticket edge is
-- meaningless more than once, so let the database reject the loser.
--
-- This index is the ONLY thing that rejects the loser. Zero compiles every insert to
-- `INSERT ... ON CONFLICT (<primary key>) DO NOTHING`, so a duplicate primary key is a
-- silent no-op, not an error — the losing push would sail on and write a second
-- activity, a second system message and a second notification. `subTicketId` is
-- therefore derived from (ticketId, mappedTicketId) so the two pushes converge on one
-- sub_tickets row, while `mappingId` stays a fresh uuid per click so the mapping
-- insert has no primary-key conflict to absorb and hits THIS constraint instead,
-- rolling its whole transaction back. See packages/shared/src/tickets/utils.ts.
--
-- Deliberately NOT unique on sub_tickets(mappedTicketId): services/subTicketService.ts
-- keys a FLOW sub-ticket row by (rootTicketId, mappedTicketId), so one ticket
-- legitimately has one row per flow run.
--
-- CONCURRENTLY so this does not lock the table on a large workspace. A concurrent
-- build that fails leaves an INVALID index behind, which a bare
-- `CREATE ... IF NOT EXISTS` would then skip forever — so drop first. If the build
-- fails because duplicate pairs already exist, de-duplicate and re-run:
--   DELETE FROM "public"."ticket_sub_ticket_mappings" a
--    USING "public"."ticket_sub_ticket_mappings" b
--    WHERE a."ticketId" = b."ticketId"
--      AND a."subTicketId" = b."subTicketId"
--      AND a."id" > b."id";

-- DropIndex
DROP INDEX CONCURRENTLY IF EXISTS "public"."ticket_sub_ticket_mappings_ticketId_subTicketId_key";

-- CreateIndex
CREATE UNIQUE INDEX CONCURRENTLY "ticket_sub_ticket_mappings_ticketId_subTicketId_key"
  ON "public"."ticket_sub_ticket_mappings" ("ticketId", "subTicketId");
