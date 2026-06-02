-- Optional response-suffix string the Twin appends to every reply
-- (mention-driven flow). Null = no suffix. Length-capped at the route
-- (500 chars); not enforced at SQL since varchar limits are noisy in
-- ORMs and the route is the only writer.

ALTER TABLE "users"
  ADD COLUMN "digitalTwinResponseSuffix" TEXT;
