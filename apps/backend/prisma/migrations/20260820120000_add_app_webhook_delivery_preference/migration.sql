ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN IF NOT EXISTS "appWebhookDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true;
