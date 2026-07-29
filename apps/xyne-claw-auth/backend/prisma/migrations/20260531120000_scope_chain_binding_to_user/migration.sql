-- Scope chain-workflow bindings to a user.
--
-- Until now a binding was keyed by (channelId, entryAgentSlug) ONLY, so ANY
-- user who triggered the entry agent in that channel fired the workflow. We add
-- `userId` so a binding applies to a specific user.
--
-- Product decision for existing rows: scope each legacy binding to its CREATOR
-- (createdByUserId). After this migration a legacy workflow still fires, but
-- only for the person who set it up — not the whole channel. createdByUserId,
-- the Spaces user id, and claw-auth User.id are all the same id-space (local
-- users are JIT-created with id = spaces user id), so the runtime lookup by
-- ctx.senderId matches the backfilled value exactly.
--
-- The string "*" is a RESERVED sentinel for an explicit channel-wide binding
-- (any user). Legacy rows are intentionally NOT set to "*" — that would
-- preserve the cross-user leak we are removing.

-- 1) Add nullable, backfill to creator, then enforce NOT NULL.
ALTER TABLE "channel_agent_chain_bindings"
    ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "channel_agent_chain_bindings"
    SET "userId" = "createdByUserId"
    WHERE "userId" IS NULL;

ALTER TABLE "channel_agent_chain_bindings"
    ALTER COLUMN "userId" SET NOT NULL;

-- 2) Swap uniqueness from (channel, slug) to (channel, slug, user).
ALTER TABLE "channel_agent_chain_bindings"
    DROP CONSTRAINT IF EXISTS "channel_agent_chain_bindings_channelId_entryAgentSlug_key";

ALTER TABLE "channel_agent_chain_bindings"
    ADD CONSTRAINT "channel_agent_chain_bindings_channelId_entryAgentSlug_userId_key"
    UNIQUE ("channelId", "entryAgentSlug", "userId");

-- 3) Index for the per-user lookup / fan-out.
CREATE INDEX IF NOT EXISTS "channel_agent_chain_bindings_userId_idx"
    ON "channel_agent_chain_bindings" ("userId");
