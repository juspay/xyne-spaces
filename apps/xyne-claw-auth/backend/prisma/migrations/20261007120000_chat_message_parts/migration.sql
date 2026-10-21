-- The assistant turn as ordered parts (thinking, text, tool calls) — see
-- @xyne/shared AssistantPart. Manual-apply safe: nullable, no backfill, no default.

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "parts" JSONB;
