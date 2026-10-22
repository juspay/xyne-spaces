-- Channel-level setting for the "email to channel" feature. When true, emails posted into the
-- channel (messageSubtype = channel_email) render expanded by default in the chat feed instead
-- of as a collapsed subject/sender row. No DB default: NULL is treated as false (collapsed) by
-- the dashboard, so existing channels keep the current collapsed view without a backfill.
ALTER TABLE "public"."channels" ADD COLUMN "expandChannelEmailsByDefault" BOOLEAN;
