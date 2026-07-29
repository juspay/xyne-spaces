-- Learned respond/ignore policy on the user (default preserves existing behaviour).
ALTER TABLE "users" ADD COLUMN "digitalTwinRespondPolicy" TEXT NOT NULL DEFAULT 'always';

-- Durable behavioural signals: one row per inbound mention the user responded to
-- or ignored. Written by the Context Assembler independently of the curator LLM,
-- so a failed distill never loses the signal. Powers the respond/ignore gate.
CREATE TABLE "twin_behavior_signals" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "eventType"       TEXT NOT NULL DEFAULT 'mention',
  "outcome"         TEXT NOT NULL,
  "channelId"       TEXT,
  "channelName"     TEXT,
  "channelType"     TEXT,
  "actorId"         TEXT,
  "latencyMs"       INTEGER,
  "sourceMessageId" TEXT,
  "triggerPreview"  TEXT,
  "occurredAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "twin_behavior_signals_pkey" PRIMARY KEY ("id")
);

-- Idempotent per (user, trigger message) so a re-backfill upserts, not duplicates.
CREATE UNIQUE INDEX "twin_behavior_signals_userId_sourceMessageId_key"
  ON "twin_behavior_signals" ("userId", "sourceMessageId");
CREATE INDEX "twin_behavior_signals_userId_occurredAt_idx"
  ON "twin_behavior_signals" ("userId", "occurredAt");
CREATE INDEX "twin_behavior_signals_userId_outcome_idx"
  ON "twin_behavior_signals" ("userId", "outcome");
CREATE INDEX "twin_behavior_signals_userId_channelType_outcome_idx"
  ON "twin_behavior_signals" ("userId", "channelType", "outcome");

ALTER TABLE "twin_behavior_signals"
  ADD CONSTRAINT "twin_behavior_signals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

