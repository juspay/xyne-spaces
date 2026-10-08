-- The same URL is filed into several SDLC folders as a matter of course, so the
-- database no longer refuses it. Channel link lists still reject duplicates,
-- enforced in the createLink mutator, which already made this check in code.
--
-- The replacement index keeps that lookup on the same columns, so the check costs
-- what it did before.
DROP INDEX IF EXISTS "links_createdBy_url_channelId_key";

CREATE INDEX IF NOT EXISTS "links_createdBy_url_channelId_idx"
  ON "public"."links" ("createdBy", "url", "channelId");
