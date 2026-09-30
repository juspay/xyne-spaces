-- Keep tickets."statusUpdatedAt" in sync with tickets."statusV2" for EVERY writer.
--
-- Before this, only the Zero `ticket.update` mutator (and a few backfill scripts)
-- stamped statusUpdatedAt. Every other path that changes statusV2 left it at the
-- creation time, e.g.:
--   - ticketRepository.updateTicketStage / updateTicketFields (Desk API, automations
--     update-ticket / close-ticket / change-stage steps, workflow status sync)
--   - ticketService.updateTicket (public/apps ticket API)
--   - Zero nonLinear.transition, stage-approval, release updateStatus, and the
--     board-transfer branch of ticket.update
--
-- Enforcing the invariant in the database means current and future writers
-- (Zero server mutators, Prisma, raw SQL) cannot drift.
--
-- Semantics:
--   * statusV2 changed AND the writer did not set statusUpdatedAt itself
--       -> statusUpdatedAt = now()
--   * writer explicitly sets statusUpdatedAt (e.g. ticket.update passes the
--     client timestamp, or the "ETA changed while PAUSED" pause-timer reset)
--       -> value is respected untouched
--   * statusV2 unchanged -> no-op
--
-- Idempotent: safe to run more than once (CREATE OR REPLACE + DROP IF EXISTS).

CREATE OR REPLACE FUNCTION "public"."tickets_set_status_updated_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."statusV2" IS DISTINCT FROM OLD."statusV2"
     AND NEW."statusUpdatedAt" IS NOT DISTINCT FROM OLD."statusUpdatedAt" THEN
    -- Prisma stores DateTime as UTC in TIMESTAMP(3) (no tz), so pin to UTC
    -- rather than depending on the session TimeZone.
    NEW."statusUpdatedAt" := (now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "tickets_set_status_updated_at" ON "public"."tickets";

CREATE TRIGGER "tickets_set_status_updated_at"
BEFORE UPDATE OF "statusV2" ON "public"."tickets"
FOR EACH ROW
EXECUTE FUNCTION "public"."tickets_set_status_updated_at"();
