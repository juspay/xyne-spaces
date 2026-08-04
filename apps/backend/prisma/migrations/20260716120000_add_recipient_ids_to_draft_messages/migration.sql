-- AlterTable: add recipientIds to draft_messages so compose-DM drafts (which
-- have no real channel yet, only a `composedm-<uuid>` placeholder channelId) can persist
-- the sorted list of recipient user ids used to resolve/create the DM channel
-- on send and to render recipients in Drafts & Sent. Stored as a comma-separated
-- string (TEXT) to avoid Prisma's lack of nullable array support. NULL for
-- channel/conversation drafts that have no recipients.
ALTER TABLE "public"."draft_messages" ADD COLUMN "recipientIds" TEXT;
