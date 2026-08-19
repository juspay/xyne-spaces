-- Backstop for subTicket.linkExisting: a parent -> sub-ticket edge is meaningless more
-- than once, and the mutator's read-then-write dedupe cannot survive two concurrent
-- pushes on its own.
--
-- This index is the only thing that rejects the loser. Zero compiles inserts to
-- `ON CONFLICT (<pk>) DO NOTHING`, so a duplicate primary key is a silent no-op, not an
-- error. `subTicketId` is derived from (ticketId, mappedTicketId) so both pushes
-- converge on one sub_tickets row, while `mappingId` stays random so the mapping insert
-- hits THIS constraint and rolls back. See packages/shared/src/tickets/utils.ts.
--
-- NOT unique on sub_tickets(mappedTicketId): services/subTicketService.ts keys a FLOW
-- row by (rootTicketId, mappedTicketId), so one ticket legitimately has one row per run.
--
-- CONCURRENTLY to avoid locking the table; DROP first because a failed concurrent build
-- leaves an INVALID index that a bare IF NOT EXISTS would skip forever. If the build
-- fails on existing duplicates, de-duplicate and re-run:
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
