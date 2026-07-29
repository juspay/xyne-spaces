-- Add denormalized initial message and parent message markdown fields to conversations
ALTER TABLE "conversations" ADD COLUMN "initial_message_md" TEXT;
ALTER TABLE "conversations" ADD COLUMN "parent_message_md" TEXT;
