CREATE TABLE IF NOT EXISTS "non_zero"."entity_feedback" (
    "workspaceId"    TEXT NOT NULL,
    "id"             TEXT NOT NULL,
    "messageId"      TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "entityId"       TEXT NOT NULL,
    "verdict"        TEXT NOT NULL,
    "remarks"        TEXT,
    "createdBy"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_feedback_pkey" PRIMARY KEY ("id")
);

-- One verdict per (message, entity, reviewer). Including the reviewer is what
-- stops two people overwriting each other: re-reviewing upserts your own row,
-- while a second reviewer adds theirs and the disagreement stays visible.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_feedback_messageId_entityId_createdBy_key"
    ON "non_zero"."entity_feedback"("messageId", "entityId", "createdBy");
-- Reads are `WHERE "workspaceId" = $1 AND "entityId" = $2`; this serves them.
-- Nothing on (messageId, entityId): a btree on (a,b) is a leading prefix of the unique
-- index above, so Postgres serves the same lookups from it. Nothing on conversationId
-- either — no query filters by it.
CREATE INDEX IF NOT EXISTS "entity_feedback_entityId_idx"
    ON "non_zero"."entity_feedback"("entityId");
