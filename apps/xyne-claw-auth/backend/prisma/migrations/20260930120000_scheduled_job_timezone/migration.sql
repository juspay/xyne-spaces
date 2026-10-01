-- Per-job IANA timezone for cron schedules. NULL = Asia/Kolkata (the previous
-- hardcoded default), so existing rows keep firing at the same time.
ALTER TABLE "scheduled_jobs" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
