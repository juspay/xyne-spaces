-- Hand-written (Prisma cannot express partial indexes).
--
-- Enforces one active DEFAULT channel per (workspace, name). ChannelRepository.create() and
-- createSdlcChannel() check for an existing name and then insert in a separate statement, so two
-- concurrent requests could both pass the check and create duplicate channels (PY-JP-002). The app
-- maps the resulting P2002 to HTTP 409 DUPLICATE_CHANNEL_NAME.
--
-- Scope:
--   * scopeType = 'DEFAULT' only. DM / GROUP_DM names are sorted participant-id lists with known
--     historical duplicates (XYNE-64861 owns that index + merge); TICKET / DOCUMENT channels are
--     not user-named.
--   * isArchived = false, so archived channels never block the index build and name reuse after
--     archival (XYNE-60986) keeps working.
--
-- PRE-DEPLOY: this fails if duplicates already exist. Run the audit in the PR description first.
-- CONCURRENTLY: channels is on the hot read/write path (and Zero-replicated); avoid an exclusive lock.
-- No IF NOT EXISTS on purpose: a failed CONCURRENTLY build leaves an INVALID index, and IF NOT EXISTS
-- would silently skip it on retry. If the build fails, DROP INDEX CONCURRENTLY it, fix data, re-run.
CREATE UNIQUE INDEX CONCURRENTLY "channels_workspaceId_name_active_default_key"
  ON "public"."channels" ("workspaceId", "name")
  WHERE "scopeType" = 'DEFAULT' AND "isArchived" = false;
