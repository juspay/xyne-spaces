-- Per-user opt-in: Xyne Automatic joins the user's Google Meet calendar events.
-- 'organized' = meetings the user organizes, 'all' = every meeting not declined, NULL = off.
ALTER TABLE "public"."user_preferences" ADD COLUMN "meetAutoJoin" TEXT;
