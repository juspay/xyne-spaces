-- Lower the column default for active_goals.maxTurns from 20 → 5.
--
-- Reason: in practice each /goal is "one good attempt + at most a couple
-- of fix turns (audit reopen + retry)". Longer loops burn LLM cost on
-- judge-driven rabbit holes — especially the artefact-blindness bug where
-- the judge cannot see the attachments the worker already posted and keeps
-- voting continue.
--
-- Only affects rows inserted AFTER this migration. Existing in-flight
-- goals keep their stored maxTurns (typically 20), so anything already
-- running won't suddenly hit the cap — caller can `/stop` if they want.

ALTER TABLE "active_goals" ALTER COLUMN "maxTurns" SET DEFAULT 5;
