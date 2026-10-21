-- Channel-level setting for the "email to channel" feature. When true, emails posted into the
-- channel (messageSubtype = channel_email) render expanded by default in the chat feed instead
-- of as a collapsed subject/sender row. Defaults false to preserve the existing collapsed view.
ALTER TABLE "public"."channels" ADD COLUMN "expandChannelEmailsByDefault" BOOLEAN DEFAULT false;
