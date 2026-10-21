-- FlowUI artifact cards posted into a Xyne AI chat, as a FlowDefinition[].
-- Manual-apply safe: nullable, no backfill, no default.

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "uiFlows" JSONB;
