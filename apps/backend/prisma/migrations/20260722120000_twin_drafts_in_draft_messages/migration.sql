-- Digital Twin reply drafts move from Redis into the draft_messages table.
-- Adds a NULLABLE origin discriminator (null=legacy user | 'user' | 'twin') + a
-- twin-only stringified-JSON metadata payload, and replaces the one-draft-per-thread
-- unique constraint with a PARTIAL unique index scoped to `origin IS DISTINCT FROM
-- 'twin'` so a thread can hold multiple twin drafts alongside the user's single
-- composer draft (legacy null rows count as the user's draft until backfilled).

-- AlterTable: origin is a NULLABLE plain TEXT column with NO default (DB enums are
-- frozen — values 'user'|'twin' are validated app-side, not by a Postgres enum type).
-- A null origin means a legacy user draft (rows that predate this column) — treated as
-- 'user' everywhere and backfilled later. New user drafts write 'user' explicitly; twin
-- proposals write 'twin'. Keeps the add a fast metadata-only op (no rewrite).
-- metadata is stringified JSON (TEXT), not JSONB.
ALTER TABLE "public"."draft_messages"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "metadata" TEXT;

-- DropIndex: the old unconditional unique (one row per channel/conversation/message/user).
-- Plain DROP (fast metadata op, brief lock) — deliberately NOT CONCURRENTLY: this DB has
-- Zero DDL event triggers that fire on ddl_command_start, so DROP INDEX CONCURRENTLY can
-- never be the "first action in transaction" and errors. The expensive index BUILDs below
-- stay CONCURRENTLY (which the Zero trigger tolerates).
DROP INDEX IF EXISTS "public"."draft_messages_channelId_conversationId_messageId_userId_key";

-- CreateIndex: twin read path (userDrafts scoped to origin='user' / twinDrafts to 'twin').
-- CONCURRENTLY to avoid an ACCESS EXCLUSIVE lock while the index builds.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_userId_origin_idx" ON "public"."draft_messages"("userId", "origin");

-- CreateIndex: partial unique — at most one NON-twin (user or legacy-null) draft per
-- (channel, conversation, message, user). `IS DISTINCT FROM 'twin'` also covers legacy
-- null rows, so the one-composer-draft-per-thread invariant holds before the null
-- backfill; twin drafts stay unconstrained (multiple per thread). Built CONCURRENTLY;
-- the DROP above already removed the same-named old index so there is no name clash.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_channelId_conversationId_messageId_userId_key"
  ON "public"."draft_messages"("channelId", "conversationId", "messageId", "userId")
  WHERE "origin" IS DISTINCT FROM 'twin';
