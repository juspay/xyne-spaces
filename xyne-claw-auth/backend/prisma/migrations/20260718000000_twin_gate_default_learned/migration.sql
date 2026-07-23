-- Digital Twin: make the respond/ignore gate the DEFAULT for all users.
-- 1. New users default to the gate ("learned") instead of the always-reply bypass.
ALTER TABLE "users" ALTER COLUMN "digitalTwinRespondPolicy" SET DEFAULT 'learned';
-- 2. Flip existing users onto the gate. Overrides any prior explicit "always"
--    opt-out (indistinguishable from the old default); users can opt back out
--    via the settings toggle.
UPDATE "users" SET "digitalTwinRespondPolicy" = 'learned' WHERE "digitalTwinRespondPolicy" = 'always';
