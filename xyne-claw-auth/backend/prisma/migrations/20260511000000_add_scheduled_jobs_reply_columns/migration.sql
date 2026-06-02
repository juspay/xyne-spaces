-- Add `replyMode` and `targetChannelId` columns to `scheduled_jobs` for
-- configurable delivery of scheduled job results.
--
-- `replyMode`
--   - "thread"  (default) replies in the originating conversation thread.
--   - "channel" posts the result as a new top-level message in the
--                 channel — uses `targetChannelId` if set, else `channelId`.
--
-- `targetChannelId`
--   Override target channel for `replyMode = 'channel'` deliveries. NULL
--   preserves existing behaviour (use the originating `channelId`). Only
--   consulted when replyMode = 'channel'.
ALTER TABLE "scheduled_jobs"
    ADD COLUMN IF NOT EXISTS "replyMode" TEXT NOT NULL DEFAULT 'thread',
    ADD COLUMN IF NOT EXISTS "targetChannelId" TEXT;
