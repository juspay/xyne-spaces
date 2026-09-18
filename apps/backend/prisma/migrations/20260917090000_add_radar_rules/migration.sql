-- Radar rules: one reader's standing answer to "keep this out of my way".
--
-- Rules used to live in the browser, the way radar teams still do. They move
-- here because the server decides the verdict now: the feed classifies every
-- item against the asking reader's rules as it is read, so a notifier or
-- another client honours a rule by asking the same code.
--
-- Per user, and only ever read as "every rule belonging to this user", so one
-- composite index is the whole access pattern.
CREATE TABLE "non_zero"."radar_rules" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "radar_rules_workspaceId_userId_idx"
    ON "non_zero"."radar_rules"("workspaceId", "userId");

-- What the mention scope tests: the user groups the ask's source message
-- @mentioned, stamped at parse time. Denormalized because rules are evaluated
-- per viewer on every feed read, and deriving this from the message would put a
-- messages lookup in front of each one.
--
-- Backfills to empty, so a mention rule does not match items parsed before this
-- existed. Nothing is hidden by that — an item with no groups is one no mention
-- rule claims.
ALTER TABLE "non_zero"."execution_items"
    ADD COLUMN "mentionedGroupIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
