-- Agent cloning: let the requester name their copy at request time.
-- Additive only — nullable, no backfill. Null means the clone falls back to
-- "<source> (Copy)" when the owner approves.
ALTER TABLE "agent_requests" ADD COLUMN "requestedName" TEXT;
