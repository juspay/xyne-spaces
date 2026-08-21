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
CREATE INDEX IF NOT EXISTS "entity_feedback_entityId_idx"
    ON "non_zero"."entity_feedback"("entityId");
CREATE INDEX IF NOT EXISTS "entity_feedback_conversationId_idx"
    ON "non_zero"."entity_feedback"("conversationId");
-- Reads tally every reviewer's verdict for a message, so this pair is the hot path.
CREATE INDEX IF NOT EXISTS "entity_feedback_messageId_entityId_idx"
    ON "non_zero"."entity_feedback"("messageId", "entityId");
